import { run } from '../process';
import { DeviceInfo, DeviceState } from './types';

/** Parses `xcrun simctl list devices --json`; keeps available iOS simulators only (no tvOS, watchOS, visionOS). */
export function parseSimctl(json: string): DeviceInfo[] {
    const data = JSON.parse(json) as { devices?: Record<string, any[]> };
    const out: DeviceInfo[] = [];
    for (const [runtime, list] of Object.entries(data.devices ?? {})) {
        const m = /SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$/.exec(runtime);
        if (!m) {
            continue;
        }
        const version = [m[1], m[2], m[3]].filter(v => v !== undefined).join('.');
        for (const d of list ?? []) {
            if (d?.isAvailable === false || typeof d?.udid !== 'string') {
                continue;
            }
            const state: DeviceState = d.state === 'Booted' ? 'ready' : d.state === 'Shutdown' ? 'shutdown' : d.state === 'Booting' ? 'booting' : 'unavailable';
            out.push({
                id: d.udid,
                name: String(d.name ?? d.udid),
                platform: 'ios',
                kind: 'simulator',
                version,
                state,
                reason: state === 'unavailable' ? `The simulator is ${String(d.state).toLowerCase()}.` : undefined,
            });
        }
    }
    // Booted first, then newest runtime, then name.
    const rank = (d: DeviceInfo) => (d.state === 'ready' ? 0 : d.state === 'booting' ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b) || compareVersions(b.version, a.version) || a.name.localeCompare(b.name));
}

export function compareVersions(a = '', b = ''): number {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d) {
            return d;
        }
    }
    return 0;
}

export async function listSimulators(): Promise<DeviceInfo[]> {
    const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', '--json'], 20_000);
    return parseSimctl(stdout);
}

/** Boots a simulator and shows it in the Simulator app. An already booted simulator is fine. */
export async function bootSimulator(udid: string): Promise<void> {
    try {
        await run('xcrun', ['simctl', 'boot', udid], 120_000);
    } catch (e) {
        if (!/current state: Booted|Unable to boot device in current state: Booted/i.test((e as Error).message)) {
            throw e;
        }
    }
    await run('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid], 10_000).catch(() => undefined);
    await run('xcrun', ['simctl', 'bootstatus', udid], 180_000).catch(() => undefined);
}
