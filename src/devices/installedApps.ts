import { run } from '../process';
import { resolveAdb } from './adb';
import { DeviceInfo } from './types';

export interface InstalledApp {
    /** Android package or iOS bundle id. */
    id: string;
    name?: string;
    /** A system app (iOS); Android lists third-party packages only. */
    system?: boolean;
}

const byUserThenId = (a: InstalledApp, b: InstalledApp) => Number(!!a.system) - Number(!!b.system) || a.id.localeCompare(b.id);

/** Appium's own helper apps (UiAutomator2 server, Appium Settings, WebDriverAgent): never the app under test. */
export function isAppiumHelper(id: string): boolean {
    return /^io\.appium\./.test(id) || /^com\.facebook\.WebDriverAgentRunner/.test(id) || /\.WebDriverAgentRunner(\.xctrunner)?$/.test(id);
}

/** `adb shell pm list packages -3`: lines `package:com.example.app`. */
export function parseAndroidPackages(stdout: string): InstalledApp[] {
    const ids = new Set<string>();
    for (const m of stdout.matchAll(/^package:(\S+)\s*$/gm)) {
        ids.add(m[1]);
    }
    return [...ids].filter(id => !isAppiumHelper(id)).sort((a, b) => a.localeCompare(b)).map(id => ({ id }));
}

/**
 * `cmd package resolve-activity --brief ... <package>`: the last line is `<package>/<activity>`. Returns the activity
 * as written there (`.MainActivity` or a full class name), or undefined when the package has no launcher activity.
 */
export function parseLaunchActivity(stdout: string, pkg: string): string | undefined {
    const line = stdout.split(/\r?\n/).map(l => l.trim()).reverse().find(l => l.startsWith(pkg + '/'));
    return line ? line.slice(pkg.length + 1) : undefined;
}

/**
 * Parses an old-style (OpenStep) property list, the format `xcrun simctl listapps` prints: dictionaries `{ k = v; }`,
 * arrays `( a, b )` and quoted or bare strings. Data blocks `<...>` are kept as strings.
 */
export function parseOpenStepPlist(text: string): unknown {
    let i = 0;
    const fail = (what: string): never => {
        throw new Error(`Invalid property list: ${what} at ${i}`);
    };
    const skip = () => {
        for (;;) {
            while (i < text.length && /\s/.test(text[i])) i++;
            if (text.startsWith('//', i)) {
                while (i < text.length && text[i] !== '\n') i++;
            } else if (text.startsWith('/*', i)) {
                const end = text.indexOf('*/', i + 2);
                i = end < 0 ? text.length : end + 2;
            } else {
                return;
            }
        }
    };
    const string = (): string => {
        if (text[i] === '"') {
            let out = '';
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') {
                    const c = text[++i];
                    out += c === 'n' ? '\n' : c === 't' ? '\t' : c;
                } else {
                    out += text[i];
                }
                i++;
            }
            if (text[i] !== '"') fail('unterminated string');
            i++;
            return out;
        }
        if (text[i] === '<') {
            const end = text.indexOf('>', i);
            if (end < 0) fail('unterminated data');
            const data = text.slice(i, end + 1);
            i = end + 1;
            return data;
        }
        const m = /^[A-Za-z0-9_$+/:.\-]+/.exec(text.slice(i));
        if (!m) fail('unexpected character');
        i += m![0].length;
        return m![0];
    };
    const value = (): unknown => {
        skip();
        if (text[i] === '{') {
            i++;
            const dict: Record<string, unknown> = {};
            for (;;) {
                skip();
                if (text[i] === '}') {
                    i++;
                    return dict;
                }
                const key = string();
                skip();
                if (text[i] !== '=') fail('expected =');
                i++;
                dict[key] = value();
                skip();
                if (text[i] === ';') i++;
                else if (text[i] !== '}') fail('expected ;');
            }
        }
        if (text[i] === '(') {
            i++;
            const list: unknown[] = [];
            for (;;) {
                skip();
                if (text[i] === ')') {
                    i++;
                    return list;
                }
                list.push(value());
                skip();
                if (text[i] === ',') i++;
                else if (text[i] !== ')') fail('expected ,');
            }
        }
        return string();
    };
    const result = value();
    skip();
    if (i < text.length) fail('trailing text');
    return result;
}

/** `xcrun simctl listapps <udid>`: user apps first, then system apps. */
export function parseSimctlApps(stdout: string): InstalledApp[] {
    const trimmed = stdout.trim();
    const data = (trimmed.startsWith('{') && trimmed.includes('":') ? JSON.parse(trimmed) : parseOpenStepPlist(trimmed)) as Record<string, any>;
    return Object.entries(data ?? {})
        .filter(([id, v]) => v && typeof v === 'object' && !isAppiumHelper(String(v.CFBundleIdentifier ?? id)))
        .map(([id, v]) => ({
            id: String(v.CFBundleIdentifier ?? id),
            name: String(v.CFBundleDisplayName ?? v.CFBundleName ?? '') || undefined,
            system: v.ApplicationType !== 'User',
        }))
        .sort(byUserThenId);
}

/** `xcrun devicectl device info apps --json-output -`: apps the user installed (no hidden, system or app clips). */
export function parseDevicectlApps(json: string): InstalledApp[] {
    const apps = (JSON.parse(json)?.result?.apps ?? []) as any[];
    return apps
        .filter(a => typeof a?.bundleIdentifier === 'string' && !a.hidden && !a.appClip && !a.internalApp && !isAppiumHelper(a.bundleIdentifier))
        .map(a => ({ id: a.bundleIdentifier as string, name: typeof a.name === 'string' ? a.name : undefined, system: a.removable === false }))
        .sort(byUserThenId);
}

/** Apps installed on a ready device, for the session form. */
export async function listInstalledApps(device: DeviceInfo, adbSetting: string): Promise<InstalledApp[]> {
    if (device.platform === 'android') {
        const { stdout } = await run(await resolveAdb(adbSetting), ['-s', device.id, 'shell', 'pm', 'list', 'packages', '-3'], 20_000);
        return parseAndroidPackages(stdout);
    }
    if (device.kind === 'simulator') {
        const { stdout } = await run('xcrun', ['simctl', 'listapps', device.id], 30_000);
        return parseSimctlApps(stdout);
    }
    const { stdout } = await run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', device.id, '--quiet', '--json-output', '-'], 60_000);
    return parseDevicectlApps(stdout.slice(stdout.indexOf('{')));
}

/** The launcher activity of an Android package; Appium finds it too when appActivity is left empty. */
export async function launchActivity(adbSetting: string, serial: string, pkg: string): Promise<string | undefined> {
    const { stdout } = await run(await resolveAdb(adbSetting),
        ['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', pkg], 15_000);
    return parseLaunchActivity(stdout, pkg);
}
