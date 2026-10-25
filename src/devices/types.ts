export type Platform = 'android' | 'ios';

/** emulator: Android emulator. simulator: iOS simulator. real: a physical phone or tablet. */
export type DeviceKind = 'emulator' | 'simulator' | 'real';

/**
 * ready: a session can start on it. shutdown: an iOS simulator that has to boot first. The others cannot be used and
 * carry a `reason`.
 */
export type DeviceState = 'ready' | 'shutdown' | 'booting' | 'unauthorized' | 'offline' | 'unavailable';

export interface DeviceInfo {
    /** The value for `appium:udid`: adb serial, simulator UDID or hardware UDID. */
    id: string;
    name: string;
    platform: Platform;
    kind: DeviceKind;
    version?: string;
    model?: string;
    state: DeviceState;
    reason?: string;
}
