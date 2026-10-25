import { ToolNotFoundError } from '../process';
import { adbCommand, listAndroid } from './adb';
import { listRealIos } from './devicectl';
import { listSimulators } from './simctl';
import { DeviceInfo } from './types';

export * from './types';

export interface DeviceList {
    devices: DeviceInfo[];
    /** One line per source that could not be read, e.g. "adb was not found". */
    notes: string[];
}

export interface DeviceOptions {
    adbPath: string;
    platform?: NodeJS.Platform;
}

/** Android devices and emulators everywhere; iOS simulators and devices on macOS. Sources run in parallel. */
export async function listDevices(o: DeviceOptions): Promise<DeviceList> {
    const mac = (o.platform ?? process.platform) === 'darwin';
    const sources: [string, () => Promise<DeviceInfo[]>][] = [['Android', () => listAndroid(adbCommand(o.adbPath))]];
    if (mac) {
        sources.push(['iOS simulators', listSimulators], ['iOS devices', listRealIos]);
    }
    const results = await Promise.allSettled(sources.map(([, list]) => list()));
    const devices: DeviceInfo[] = [];
    const notes: string[] = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            devices.push(...r.value);
        } else {
            notes.push(sourceNote(sources[i][0], r.reason));
        }
    });
    if (!mac) {
        notes.push('iOS needs macOS with Xcode.');
    }
    return { devices: dedupe(devices), notes };
}

function sourceNote(source: string, e: unknown): string {
    if (e instanceof ToolNotFoundError) {
        return source === 'Android'
            ? 'adb was not found: install Android platform-tools, set ANDROID_HOME, or set testflyAppiumInspector.adbPath.'
            : 'xcrun was not found: install Xcode and its command line tools.';
    }
    return `${source}: ${(e as Error).message}`;
}

function dedupe(list: DeviceInfo[]): DeviceInfo[] {
    const seen = new Set<string>();
    return list.filter(d => (seen.has(d.platform + d.id) ? false : (seen.add(d.platform + d.id), true)));
}
