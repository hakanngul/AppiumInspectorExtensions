import { DeviceInfo } from '../devices/types';

export type AppInput =
    | { kind: 'file'; path: string }
    | { kind: 'installed'; appPackage?: string; appActivity?: string; bundleId?: string }
    | { kind: 'none' };

export interface IosSigning {
    xcodeOrgId?: string;
    xcodeSigningId?: string;
    updatedWDABundleId?: string;
}

export interface CapabilityInput {
    device: DeviceInfo;
    app: AppInput;
    signing?: IosSigning;
    /** The "Advanced capabilities (JSON)" editor; wins over the generated values. */
    extra?: Record<string, unknown>;
    /** Fast start: skip what an inspector session does not need. `deviceInitialized`: Appium set this device up already. */
    fast?: { deviceInitialized?: boolean };
}

/**
 * Capabilities that make a session start and respond faster, from the drivers' own advice: no log capture, no repeated
 * device setup, and short idle waits. UiAutomator2 waits up to 10 s for the UI to go idle before every source read and
 * action (`waitForIdleTimeout`), which an app with running animations never does; XCUITest has the same wait on iOS.
 */
export function fastStartCapabilities(device: DeviceInfo, deviceInitialized = false): Record<string, unknown> {
    if (device.platform === 'android') {
        return {
            'appium:skipLogcatCapture': true,
            'appium:disableWindowAnimation': true,
            ...(deviceInitialized ? { 'appium:skipDeviceInitialization': true } : {}),
            'appium:settings': { waitForIdleTimeout: 300 },
        };
    }
    return {
        'appium:skipLogCapture': true,
        'appium:waitForIdleTimeout': 1,
    };
}

/** Capabilities the W3C spec defines; every other capability needs a vendor prefix. */
const W3C_CAPABILITIES = new Set([
    'browserName', 'browserVersion', 'platformName', 'acceptInsecureCerts', 'pageLoadStrategy', 'proxy', 'setWindowRect',
    'timeouts', 'strictFileInteractability', 'unhandledPromptBehavior', 'userAgent', 'webSocketUrl',
]);

/** `noReset` becomes `appium:noReset`; standard and already prefixed names stay as they are. */
export function prefixed(name: string): string {
    return W3C_CAPABILITIES.has(name) || name.includes(':') ? name : `appium:${name}`;
}

/** The `alwaysMatch` capabilities for a session on the chosen device and app. */
export function buildCapabilities(input: CapabilityInput): Record<string, unknown> {
    const { device, app } = input;
    const caps: Record<string, unknown> = device.platform === 'android'
        ? { platformName: 'Android', 'appium:automationName': 'UiAutomator2' }
        : { platformName: 'iOS', 'appium:automationName': 'XCUITest' };
    caps['appium:udid'] = device.id;
    caps['appium:deviceName'] = device.name;
    if (device.version) {
        caps['appium:platformVersion'] = device.version;
    }
    caps['appium:newCommandTimeout'] = 600;
    // Leave the user's app and its data alone: no reinstall, no data reset, no kill when the session ends.
    caps['appium:noReset'] = true;
    caps['appium:shouldTerminateApp'] = false;

    if (app.kind === 'file') {
        caps['appium:app'] = app.path;
    } else if (app.kind === 'installed') {
        if (device.platform === 'android') {
            setIf(caps, 'appium:appPackage', app.appPackage);
            setIf(caps, 'appium:appActivity', app.appActivity);
        } else {
            setIf(caps, 'appium:bundleId', app.bundleId);
        }
    }

    if (device.platform === 'ios' && device.kind === 'real') {
        const s = input.signing ?? {};
        setIf(caps, 'appium:xcodeOrgId', s.xcodeOrgId);
        setIf(caps, 'appium:xcodeSigningId', s.xcodeSigningId || 'Apple Development');
        setIf(caps, 'appium:updatedWDABundleId', s.updatedWDABundleId);
    }

    if (input.fast) {
        Object.assign(caps, fastStartCapabilities(device, input.fast.deviceInitialized));
    }

    for (const [name, value] of Object.entries(input.extra ?? {})) {
        const key = prefixed(name);
        const current = caps[key];
        if (key === 'appium:settings' && isObject(value) && isObject(current)) {
            caps[key] = { ...current, ...value }; // settings from the editor add to the fast-start ones
            continue;
        }
        if (value === null) {
            delete caps[key]; // null in the editor removes a generated capability
        } else {
            caps[key] = value;
        }
    }
    return caps;
}

/** Problems that make Appium refuse the session, found before it is requested. */
export function capabilityProblems(input: CapabilityInput): string[] {
    const problems: string[] = [];
    const { device, app } = input;
    if (device.state !== 'ready') {
        problems.push(device.reason ?? `${device.name} is not ready.`);
    }
    if (app.kind === 'file' && !app.path.trim()) {
        problems.push('Choose an app file.');
    }
    if (app.kind === 'installed') {
        if (device.platform === 'android' && !app.appPackage?.trim()) {
            problems.push('Enter the app package, for example com.example.app.');
        }
        if (device.platform === 'ios' && !app.bundleId?.trim()) {
            problems.push('Enter the bundle id, for example com.example.app.');
        }
        if (device.platform === 'android' && app.appPackage && !/^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(app.appPackage.trim())) {
            problems.push(`"${app.appPackage}" is not a valid Android package name.`);
        }
    }
    return problems;
}

/** Things that may make the session fail, but need not: shown, never blocking. */
export function capabilityWarnings(input: CapabilityInput): string[] {
    const { device } = input;
    const extra = input.extra ?? {};
    const signedElsewhere = ['appium:usePreinstalledWDA', 'usePreinstalledWDA', 'appium:prebuiltWDAPath', 'prebuiltWDAPath', 'appium:xcodeOrgId', 'xcodeOrgId']
        .some(k => extra[k] !== undefined && extra[k] !== false);
    if (device.platform === 'ios' && device.kind === 'real' && !input.signing?.xcodeOrgId?.trim() && !signedElsewhere) {
        return ['No Team ID set (testflyAppiumInspector.ios.xcodeOrgId). Appium needs it to sign and install WebDriverAgent on '
            + 'the device, unless WebDriverAgent is already installed and signed there.'];
    }
    return [];
}

/** Parses the advanced JSON editor: an object, or an error message. */
export function parseExtraCapabilities(text: string): { value?: Record<string, unknown>; error?: string } {
    if (!text.trim()) {
        return { value: {} };
    }
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { error: 'Advanced capabilities must be a JSON object.' };
        }
        return { value };
    } catch (e) {
        return { error: `Advanced capabilities are not valid JSON: ${(e as Error).message}` };
    }
}

function setIf(caps: Record<string, unknown>, key: string, value: string | undefined) {
    if (value?.trim()) {
        caps[key] = value.trim();
    }
}

function isObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}
