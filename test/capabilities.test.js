const test = require('node:test');
const assert = require('node:assert');
const { buildCapabilities, capabilityProblems, capabilityWarnings, parseExtraCapabilities, prefixed } = require('../out/appium/capabilities.js');
const { appFileKind, checkAppFile } = require('../out/apps.js');
const { sanitizeXml } = require('../out/appium/source.js');

const emulator = { id: 'emulator-5554', name: 'Pixel 8 API 35', platform: 'android', kind: 'emulator', version: '15', state: 'ready' };
const simulator = { id: '5F0C9F3E-1F2B-4C7D-9A1E-0B6B2E3D4A51', name: 'iPhone 17', platform: 'ios', kind: 'simulator', version: '26.0', state: 'ready' };
const iphone = { id: '00008140-001A2B3C4D5E801E', name: "Hakan's iPhone", platform: 'ios', kind: 'real', version: '26.0.1', state: 'ready' };

test('Android: UiAutomator2, the device, and the user\'s app left alone', () => {
    assert.deepStrictEqual(buildCapabilities({ device: emulator, app: { kind: 'installed', appPackage: 'com.example.app', appActivity: '.MainActivity' } }), {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': 'emulator-5554',
        'appium:deviceName': 'Pixel 8 API 35',
        'appium:platformVersion': '15',
        'appium:newCommandTimeout': 600,
        'appium:noReset': true,
        'appium:shouldTerminateApp': false,
        'appium:appPackage': 'com.example.app',
        'appium:appActivity': '.MainActivity',
    });
});

test('iOS simulator with an app file; no app at all; a bundle id', () => {
    const file = buildCapabilities({ device: simulator, app: { kind: 'file', path: '/builds/Demo.app' } });
    assert.strictEqual(file.platformName, 'iOS');
    assert.strictEqual(file['appium:automationName'], 'XCUITest');
    assert.strictEqual(file['appium:app'], '/builds/Demo.app');
    assert.ok(!('appium:xcodeOrgId' in file), 'no signing for a simulator');
    const none = buildCapabilities({ device: simulator, app: { kind: 'none' } });
    assert.ok(!('appium:app' in none) && !('appium:bundleId' in none) && !('appium:appPackage' in none));
    assert.strictEqual(buildCapabilities({ device: simulator, app: { kind: 'installed', bundleId: ' com.apple.Preferences ' } })['appium:bundleId'], 'com.apple.Preferences');
});

test('real iOS device: WebDriverAgent signing from the settings', () => {
    const caps = buildCapabilities({ device: iphone, app: { kind: 'none' }, signing: { xcodeOrgId: 'ABCDE12345', updatedWDABundleId: 'com.hakan.WebDriverAgentRunner' } });
    assert.strictEqual(caps['appium:xcodeOrgId'], 'ABCDE12345');
    assert.strictEqual(caps['appium:xcodeSigningId'], 'Apple Development');
    assert.strictEqual(caps['appium:updatedWDABundleId'], 'com.hakan.WebDriverAgentRunner');
    assert.strictEqual(caps['appium:udid'], '00008140-001A2B3C4D5E801E');
});

test('advanced JSON wins, gets the appium: prefix where W3C needs one, and null removes a value', () => {
    const caps = buildCapabilities({
        device: emulator, app: { kind: 'none' },
        extra: { noReset: false, 'appium:newCommandTimeout': 60, 'appium:shouldTerminateApp': null, 'custom:flag': 1, acceptInsecureCerts: true },
    });
    assert.strictEqual(caps['appium:noReset'], false);
    assert.strictEqual(caps['appium:newCommandTimeout'], 60);
    assert.ok(!('appium:shouldTerminateApp' in caps));
    assert.strictEqual(caps['custom:flag'], 1);
    assert.strictEqual(caps.acceptInsecureCerts, true);
    assert.strictEqual(prefixed('platformName'), 'platformName');
    assert.strictEqual(prefixed('udid'), 'appium:udid');
});

test('problems are found before Appium is asked', () => {
    assert.deepStrictEqual(capabilityProblems({ device: emulator, app: { kind: 'none' } }), []);
    assert.match(capabilityProblems({ device: emulator, app: { kind: 'installed', appPackage: '' } })[0], /app package/);
    assert.match(capabilityProblems({ device: emulator, app: { kind: 'installed', appPackage: 'not a package' } })[0], /not a valid Android package/);
    assert.match(capabilityProblems({ device: simulator, app: { kind: 'installed' } })[0], /bundle id/);
    assert.deepStrictEqual(capabilityProblems({ device: iphone, app: { kind: 'none' } }), [], 'a missing Team ID does not block');
    assert.match(capabilityWarnings({ device: iphone, app: { kind: 'none' } })[0], /No Team ID set/);
    assert.deepStrictEqual(capabilityWarnings({ device: iphone, app: { kind: 'none' }, signing: { xcodeOrgId: 'ABCDE12345' } }), []);
    assert.deepStrictEqual(capabilityWarnings({ device: iphone, app: { kind: 'none' }, extra: { usePreinstalledWDA: true } }), [], 'WDA already on the device');
    assert.deepStrictEqual(capabilityWarnings({ device: simulator, app: { kind: 'none' } }), []);
    assert.match(capabilityProblems({ device: { ...emulator, state: 'offline', reason: 'Reconnect it.' }, app: { kind: 'none' } })[0], /Reconnect/);
    assert.match(capabilityProblems({ device: emulator, app: { kind: 'file', path: ' ' } })[0], /Choose an app file/);
});

test('advanced JSON editor: object or a readable error', () => {
    assert.deepStrictEqual(parseExtraCapabilities(''), { value: {} });
    assert.deepStrictEqual(parseExtraCapabilities('{"noReset": false}'), { value: { noReset: false } });
    assert.match(parseExtraCapabilities('[1]').error, /JSON object/);
    assert.match(parseExtraCapabilities('{noReset}').error, /not valid JSON/);
});

test('app files match the device', () => {
    assert.strictEqual(appFileKind('/x/Demo.app/'), 'app');
    assert.strictEqual(appFileKind('C:\\builds\\demo.APK'), 'apk');
    assert.strictEqual(appFileKind('/x/demo.aab'), undefined);
    assert.deepStrictEqual(checkAppFile('/x/demo.apk', emulator), {});
    assert.match(checkAppFile('/x/Demo.ipa', emulator).error, /iOS app/);
    assert.match(checkAppFile('/x/demo.apk', simulator).error, /Android app/);
    assert.match(checkAppFile('/x/Demo.ipa', simulator).error, /only on a real device/);
    assert.match(checkAppFile('/x/Demo.app', iphone).warning, /simulator build/);
    assert.deepStrictEqual(checkAppFile('/x/Demo.ipa', iphone), {});
    assert.match(checkAppFile('/x/demo.aab', emulator).error, /Choose an \.apk/);
});

test('sanitizeXml drops what XML 1.0 forbids and keeps the rest', () => {
    const xml = '<a text="ok\u0001 &#1; &#x1F; &#10; &#x41; \uD83D\uDE00 \uD800"/>';
    assert.strictEqual(sanitizeXml(xml), '<a text="ok   &#10; &#x41; \uD83D\uDE00 "/>');
    assert.strictEqual(sanitizeXml('<hierarchy>\n\t<node/>\r\n</hierarchy>'), '<hierarchy>\n\t<node/>\r\n</hierarchy>');
});

test('fast start: no log capture and short idle waits, nothing that changes the device', () => {
    const { fastStartCapabilities } = require('../out/appium/capabilities.js');
    const android = buildCapabilities({ device: emulator, app: { kind: 'none' }, fast: true });
    assert.strictEqual(android['appium:skipLogcatCapture'], true);
    assert.deepStrictEqual(android['appium:settings'], { waitForIdleTimeout: 300 });
    assert.ok(!('appium:disableWindowAnimation' in android), 'breaks UiAutomation on recent emulators');
    assert.ok(!('appium:skipDeviceInitialization' in android), 'breaks UiAutomation on recent emulators');
    assert.deepStrictEqual(fastStartCapabilities(simulator), { 'appium:skipLogCapture': true, 'appium:waitForIdleTimeout': 1 });
    assert.ok(!('appium:skipLogcatCapture' in buildCapabilities({ device: emulator, app: { kind: 'none' } })), 'off: nothing added');
});

test('the advanced JSON wins over fast start; settings objects are merged', () => {
    const caps = buildCapabilities({
        device: emulator, app: { kind: 'none' }, fast: true,
        extra: { skipLogcatCapture: false, settings: { waitForIdleTimeout: 0, ignoreUnimportantViews: true } },
    });
    assert.strictEqual(caps['appium:skipLogcatCapture'], false);
    assert.deepStrictEqual(caps['appium:settings'], { waitForIdleTimeout: 0, ignoreUnimportantViews: true });
    const ios = buildCapabilities({ device: simulator, app: { kind: 'none' }, fast: true, extra: { 'appium:waitForIdleTimeout': 10 } });
    assert.strictEqual(ios['appium:waitForIdleTimeout'], 10);
});
