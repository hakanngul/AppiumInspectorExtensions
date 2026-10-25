const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseAndroidPackages, parseLaunchActivity, parseOpenStepPlist, parseSimctlApps, parseDevicectlApps } = require('../out/devices/installedApps.js');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('Android: third-party packages from pm list packages -3, sorted', () => {
    assert.deepStrictEqual(parseAndroidPackages(fixture('pm-list-packages.txt')).map(a => a.id), ['com.example.shop', 'com.starlettech.letsbet.stage'],
        'Appium\'s own helper packages are left out');
    assert.deepStrictEqual(parseAndroidPackages('\r\npackage:a.b\r\n'), [{ id: 'a.b' }]);
    assert.deepStrictEqual(parseAndroidPackages(''), []);
});

test('Android: the launcher activity from resolve-activity --brief', () => {
    assert.strictEqual(parseLaunchActivity(fixture('resolve-activity.txt'), 'com.starlettech.letsbet.stage'), 'com.starlettech.letsbet.ui.splash.SplashActivity');
    assert.strictEqual(parseLaunchActivity('priority=0\ncom.example.shop/.MainActivity\n', 'com.example.shop'), '.MainActivity');
    assert.strictEqual(parseLaunchActivity('No activity found', 'com.example.shop'), undefined);
});

test('OpenStep property lists: dictionaries, arrays, quoted and bare strings, comments', () => {
    assert.deepStrictEqual(parseOpenStepPlist('{ a = 1; "b c" = "x \\"y\\""; d = ( e, "f" ); g = {}; h = <0fab 12>; /* c */ // line\n }'),
        { a: '1', 'b c': 'x "y"', d: ['e', 'f'], g: {}, h: '<0fab 12>' });
    assert.throws(() => parseOpenStepPlist('{ a = 1 b = 2; }'), /expected ;/);
    assert.throws(() => parseOpenStepPlist('{ a = "x; }'), /unterminated string/);
});

test('iOS simulator: simctl listapps, the user\'s apps first', () => {
    assert.deepStrictEqual(parseSimctlApps(fixture('simctl-listapps.txt')), [
        { id: 'com.nesine.new-bet-dev', name: 'Nesine Dev', system: false },
        { id: 'com.apple.Preferences', name: 'Settings', system: true },
    ]);
    assert.deepStrictEqual(parseSimctlApps('{"com.a.b": {"ApplicationType": "User", "CFBundleName": "B"}}'), [{ id: 'com.a.b', name: 'B', system: false }]);
});

test('iOS device: devicectl apps without app clips; system apps flagged', () => {
    assert.deepStrictEqual(parseDevicectlApps(fixture('devicectl-apps.json')), [
        { id: 'com.nesine.new-bet-dev', name: 'Nesine Dev', system: false },
        { id: 'com.apple.mobilesafari', name: 'Safari', system: true },
    ]);
});
