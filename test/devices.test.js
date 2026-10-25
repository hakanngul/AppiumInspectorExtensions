const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseAdbDevices, parseGetprop, toDevice, adbCommand } = require('../out/devices/adb.js');
const { parseSimctl, compareVersions } = require('../out/devices/simctl.js');
const { parseDevicectl, parseXctrace } = require('../out/devices/devicectl.js');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('adb devices -l: every state, including "no permissions" with spaces', () => {
    const entries = parseAdbDevices(fixture('adb-devices.txt'));
    assert.deepStrictEqual(entries.map(e => [e.serial, e.state]), [
        ['emulator-5554', 'device'],
        ['R5CT12345AB', 'device'],
        ['0123456789ABCDEF', 'unauthorized'],
        ['192.168.1.20:5555', 'offline'],
        ['ZY22XXXXXX', 'no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html]'],
    ]);
    assert.strictEqual(entries[0].props.model, 'sdk_gphone64_arm64');
    assert.strictEqual(entries[1].props.usb, '1-1');
    assert.deepStrictEqual(parseAdbDevices('List of devices attached\n\n'), []);
    assert.deepStrictEqual(parseAdbDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n'), []);
});

test('Android devices: emulator by AVD name, real device by model, unusable ones with a reason', () => {
    const [emu, real, unauth, offline, noperm] = parseAdbDevices(fixture('adb-devices.txt'));
    assert.deepStrictEqual(toDevice(emu, parseGetprop(fixture('getprop-emulator.txt'))), {
        id: 'emulator-5554', name: 'Pixel 8 API 35', platform: 'android', kind: 'emulator', version: '15', model: 'sdk_gphone64_arm64', state: 'ready', reason: undefined,
    });
    assert.deepStrictEqual(toDevice(real, parseGetprop(fixture('getprop-real.txt'))), {
        id: 'R5CT12345AB', name: 'SM-A546E', platform: 'android', kind: 'real', version: '14', model: 'SM-A546E', state: 'ready', reason: undefined,
    });
    assert.strictEqual(toDevice(real).name, 'SM A546E', 'without getprop the adb model is used');
    assert.deepStrictEqual([toDevice(unauth).state, toDevice(offline).state, toDevice(noperm).state], ['unauthorized', 'offline', 'unavailable']);
    assert.match(toDevice(unauth).reason, /Allow USB debugging/);
    assert.match(toDevice(noperm).reason, /udev/);
    assert.strictEqual(toDevice(offline).name, 'Pixel 7');
});

test('adb is found through the setting, ANDROID_HOME or ANDROID_SDK_ROOT', () => {
    const os = require('node:os');
    const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-'));
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    fs.mkdirSync(path.join(sdk, 'platform-tools'));
    fs.writeFileSync(path.join(sdk, 'platform-tools', exe), '');
    try {
        assert.strictEqual(adbCommand('/opt/adb'), '/opt/adb');
        assert.strictEqual(adbCommand('', { ANDROID_HOME: sdk }), path.join(sdk, 'platform-tools', exe));
        assert.strictEqual(adbCommand('', { ANDROID_HOME: '/nope', ANDROID_SDK_ROOT: sdk }), path.join(sdk, 'platform-tools', exe));
        assert.strictEqual(adbCommand('', {}), 'adb');
    } finally {
        fs.rmSync(sdk, { recursive: true, force: true });
    }
});

test('simctl: available iOS simulators only, booted first, then newest runtime', () => {
    const sims = parseSimctl(fixture('simctl-devices.json'));
    assert.deepStrictEqual(sims.map(s => [s.name, s.version, s.state]), [
        ['iPhone 17', '26.0', 'ready'],
        ['iPhone 17 Pro', '26.0', 'shutdown'],
        ['iPad Air 11-inch (M3)', '18.6', 'shutdown'],
    ]);
    assert.ok(sims.every(s => s.platform === 'ios' && s.kind === 'simulator'));
    assert.strictEqual(sims[0].id, '5F0C9F3E-1F2B-4C7D-9A1E-0B6B2E3D4A51');
    assert.ok(compareVersions('26.0', '18.6') > 0 && compareVersions('18.6.1', '18.6') > 0 && compareVersions('18', '18.0') === 0);
});

test('devicectl: physical iOS devices by hardware UDID, not the CoreDevice identifier', () => {
    const devices = parseDevicectl(fixture('devicectl-devices.json'));
    assert.deepStrictEqual(devices.map(d => [d.id, d.name, d.version, d.state]), [
        ['00008140-001A2B3C4D5E801E', "Hakan's iPhone", '26.0.1', 'ready'],
        ['00008103-000A1B2C3D4E5F60', 'Test iPad', '18.6', 'unavailable'],
    ]);
    assert.match(devices[1].reason, /trust this computer/);
    assert.ok(devices.every(d => d.kind === 'real' && d.platform === 'ios'));
});

test('xctrace: devices and offline devices; the Mac and simulators are skipped', () => {
    assert.deepStrictEqual(parseXctrace(fixture('xctrace-devices.txt')).map(d => [d.id, d.name, d.version, d.state]), [
        ['00008140-001A2B3C4D5E801E', "Hakan's iPhone", '26.0.1', 'ready'],
        ['00008103-000A1B2C3D4E5F60', 'Test iPad', '18.6', 'offline'],
    ]);
});
