import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run } from '../process';
import { DeviceInfo } from './types';

/**
 * Parses the JSON file of `xcrun devicectl list devices --json-output <file>` (Xcode 15+). Keeps physical iPhones and
 * iPads. The id is `hardwareProperties.udid`, the value Appium expects as `appium:udid`; devicectl's own `identifier`
 * is a CoreDevice UUID and does not work there.
 */
export function parseDevicectl(json: string): DeviceInfo[] {
    const data = JSON.parse(json) as { result?: { devices?: any[] } };
    const out: DeviceInfo[] = [];
    for (const d of data.result?.devices ?? []) {
        const hw = d?.hardwareProperties ?? {};
        const props = d?.deviceProperties ?? {};
        const conn = d?.connectionProperties ?? {};
        if (hw.platform !== 'iOS' || hw.reality !== 'physical' || typeof hw.udid !== 'string') {
            continue;
        }
        const paired = conn.pairingState === 'paired';
        const connected = conn.tunnelState === 'connected' || typeof conn.transportType === 'string';
        out.push({
            id: hw.udid,
            name: String(props.name ?? hw.marketingName ?? hw.udid),
            platform: 'ios',
            kind: 'real',
            version: typeof props.osVersionNumber === 'string' ? props.osVersionNumber : undefined,
            model: typeof hw.marketingName === 'string' ? hw.marketingName : undefined,
            state: paired && connected ? 'ready' : 'unavailable',
            reason: !paired ? 'Not paired: unlock the device and trust this computer.'
                : !connected ? 'Not connected: plug the device in or put it on the same network.' : undefined,
        });
    }
    return out;
}

/**
 * Parses `xcrun xctrace list devices` (older Xcode): lines `Name (version) (udid)` under `== Devices ==` or
 * `== Devices Offline ==`. The Mac itself has no version and is skipped.
 */
export function parseXctrace(stdout: string): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    let section = '';
    for (const raw of stdout.split(/\r?\n/)) {
        const line = raw.trim();
        const header = /^== (.+) ==$/.exec(line);
        if (header) {
            section = header[1];
            continue;
        }
        if (section !== 'Devices' && section !== 'Devices Offline') {
            continue;
        }
        const m = /^(.+?) \(([\d.]+)\) \(([0-9A-Fa-f-]{20,})\)$/.exec(line);
        if (m) {
            out.push({
                id: m[3], name: m[1], platform: 'ios', kind: 'real', version: m[2],
                state: section === 'Devices' ? 'ready' : 'offline',
                reason: section === 'Devices' ? undefined : 'The device is offline.',
            });
        }
    }
    return out;
}

export async function listRealIos(): Promise<DeviceInfo[]> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'testfly-appium-'));
    const file = path.join(dir, 'devices.json');
    try {
        await run('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], 30_000);
        return parseDevicectl(await fs.promises.readFile(file, 'utf8'));
    } catch {
        const { stdout } = await run('xcrun', ['xctrace', 'list', 'devices'], 30_000);
        return parseXctrace(stdout);
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
}
