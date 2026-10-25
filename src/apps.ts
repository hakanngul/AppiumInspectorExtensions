import * as path from 'path';
import { DeviceInfo } from './devices/types';

/** apk: Android package. app: iOS app bundle (simulator build, or device build). ipa: iOS archive for real devices. */
export type AppFileKind = 'apk' | 'app' | 'ipa' | 'zip';

export function appFileKind(file: string): AppFileKind | undefined {
    const ext = path.extname(file.replace(/[\\/]+$/, '')).toLowerCase();
    return ext === '.apk' ? 'apk' : ext === '.app' ? 'app' : ext === '.ipa' ? 'ipa' : ext === '.zip' ? 'zip' : undefined;
}

export interface AppCheck {
    /** The file cannot work on this device. */
    error?: string;
    /** It may work, but usually does not. */
    warning?: string;
}

/** Checks an app file against the device before a session is requested. */
export function checkAppFile(file: string, device: DeviceInfo): AppCheck {
    const kind = appFileKind(file);
    if (!kind) {
        return { error: 'Choose an .apk (Android), .app (iOS simulator) or .ipa (iOS device) file.' };
    }
    if (device.platform === 'android') {
        return kind === 'apk' ? {} : kind === 'zip' ? { warning: 'Android needs an .apk; a .zip is passed to Appium as is.' }
            : { error: `An .${kind} file is an iOS app; ${device.name} is an Android device.` };
    }
    if (kind === 'apk') {
        return { error: `An .apk file is an Android app; ${device.name} is an iOS ${device.kind}.` };
    }
    if (device.kind === 'simulator' && kind === 'ipa') {
        return { error: 'An .ipa runs only on a real device. Use a simulator build (.app) for a simulator.' };
    }
    if (device.kind === 'real' && kind === 'app') {
        return { warning: 'A simulator build (.app) does not run on a real device; use a device build or an .ipa.' };
    }
    return {};
}
