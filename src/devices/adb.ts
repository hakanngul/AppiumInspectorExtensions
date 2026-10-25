import * as fs from 'fs';
import * as path from 'path';
import { run } from '../process';
import { DeviceInfo, DeviceState } from './types';

export interface AdbEntry {
    serial: string;
    /** adb's state word: device, unauthorized, offline, "no permissions (...)", ... */
    state: string;
    props: Record<string, string>;
}

/** Parses `adb devices -l`. */
export function parseAdbDevices(stdout: string): AdbEntry[] {
    const entries: AdbEntry[] = [];
    for (const raw of stdout.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('List of devices') || line.startsWith('*')) {
            continue;
        }
        const [serial, ...rest] = line.split(/\s+/);
        // The state is everything before the first key:value token; it can contain spaces ("no permissions (...)").
        const firstProp = rest.findIndex(t => /^[a-z_]+:/.test(t) && !t.startsWith('http'));
        const stateTokens = firstProp < 0 ? rest : rest.slice(0, firstProp);
        const props: Record<string, string> = {};
        for (const token of firstProp < 0 ? [] : rest.slice(firstProp)) {
            const i = token.indexOf(':');
            if (i > 0) {
                props[token.slice(0, i)] = token.slice(i + 1);
            }
        }
        entries.push({ serial, state: stateTokens.join(' '), props });
    }
    return entries;
}

/** Parses `adb shell getprop` lines: `[key]: [value]`. */
export function parseGetprop(stdout: string): Record<string, string> {
    const props: Record<string, string> = {};
    for (const m of stdout.matchAll(/^\[([^\]]+)\]:\s*\[([^\]]*)\]/gm)) {
        props[m[1]] = m[2];
    }
    return props;
}

/** One DeviceInfo from an adb entry and, for a usable device, its getprop output. */
export function toDevice(entry: AdbEntry, getprop: Record<string, string> = {}): DeviceInfo {
    const emulator = entry.serial.startsWith('emulator-') || getprop['ro.kernel.qemu'] === '1' || getprop['ro.boot.qemu'] === '1';
    const avd = getprop['ro.boot.qemu.avd_name'] || getprop['ro.kernel.qemu.avd_name'];
    const model = getprop['ro.product.model'] || entry.props.model?.replace(/_/g, ' ');
    const { state, reason } = adbState(entry.state);
    return {
        id: entry.serial,
        name: (emulator && avd ? avd.replace(/_/g, ' ') : model) || entry.serial,
        platform: 'android',
        kind: emulator ? 'emulator' : 'real',
        version: getprop['ro.build.version.release'] || undefined,
        model: model || undefined,
        state,
        reason,
    };
}

function adbState(word: string): { state: DeviceState; reason?: string } {
    if (word === 'device') {
        return { state: 'ready' };
    }
    if (word === 'unauthorized') {
        return { state: 'unauthorized', reason: 'Allow USB debugging on the device, then reload.' };
    }
    if (word === 'offline') {
        return { state: 'offline', reason: 'The device is offline. Reconnect it or restart the emulator.' };
    }
    if (word.startsWith('no permissions')) {
        return { state: 'unavailable', reason: 'No permission to use the USB device (udev rules on Linux).' };
    }
    return { state: 'unavailable', reason: `adb reports "${word}".` };
}

/** adb from the setting, ANDROID_HOME, ANDROID_SDK_ROOT, or the PATH. */
export function adbCommand(setting: string, env: NodeJS.ProcessEnv = process.env): string {
    if (setting.trim()) {
        return setting.trim();
    }
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    for (const root of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) {
        if (root) {
            const candidate = path.join(root, 'platform-tools', exe);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return 'adb';
}

export async function listAndroid(adb: string): Promise<DeviceInfo[]> {
    const { stdout } = await run(adb, ['devices', '-l'], 10_000);
    return Promise.all(parseAdbDevices(stdout).map(async entry => {
        if (entry.state !== 'device') {
            return toDevice(entry);
        }
        try {
            const props = await run(adb, ['-s', entry.serial, 'shell', 'getprop'], 8_000);
            return toDevice(entry, parseGetprop(props.stdout));
        } catch {
            return toDevice(entry);
        }
    }));
}
