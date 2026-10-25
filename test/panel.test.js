// The inspector panel's host side with a stand-in for the vscode module and a fake Appium server that serves a
// session with the Android fixture: form -> preview -> session -> screen -> tap -> verify -> end.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');

// ── a minimal vscode module ─────────────────────────────────────────────
const posted = [];
let receive;
let config = {};
class EventEmitter {
    constructor() { this.listeners = []; this.event = l => (this.listeners.push(l), { dispose() {} }); }
    fire(v) { this.listeners.forEach(l => l(v)); }
    dispose() {}
}
const vscodeStub = {
    EventEmitter,
    Uri: { joinPath: (...p) => ({ fsPath: p.map(x => x.fsPath || x).join('/') }) },
    ViewColumn: { Active: -1, Beside: -2 },
    ProgressLocation: { Notification: 15 },
    window: {
        createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
        createWebviewPanel: () => ({
            webview: { html: '', cspSource: 'vscode-resource:', asWebviewUri: u => u, postMessage: m => (posted.push(m), Promise.resolve(true)), onDidReceiveMessage: h => ((receive = h), { dispose() {} }) },
            onDidDispose(h) { this.disposed = h; return { dispose() {} }; }, reveal() {}, dispose() { this.disposed && this.disposed(); },
        }),
        withProgress: (_o, task) => task(),
        showErrorMessage: () => Promise.resolve(undefined),
        showInformationMessage: () => Promise.resolve(undefined),
        showWarningMessage: () => Promise.resolve(undefined),
        setStatusBarMessage() {},
    },
    workspace: {
        getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    env: { clipboard: { writeText: () => Promise.resolve() } },
};
const load = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscodeStub : load.call(this, request, ...rest);
};

const { InspectorPanel, sameActivity } = require('../out/inspectorPanel.js');
const { AppiumController } = require('../out/controller.js');

// ── a fake Appium with one session ──────────────────────────────────────
const SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'android-source.xml'), 'utf8');
function fakeAppium({ uiAutomationBusy = 0 } = {}) {
    const calls = [];
    let busy = uiAutomationBusy;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
            const json = body ? JSON.parse(body) : undefined;
            calls.push({ method: req.method, url: req.url, body: json });
            const send = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); };
            const u = req.url.replace(/^\/session\/abc/, '');
            if (req.url === '/status') return send(200, { ready: true, message: 'ready', build: { version: '3.8.0' } });
            if (req.method === 'POST' && req.url === '/session' && busy > 0) {
                busy--;
                return send(500, { error: 'session not created', message: 'A new session could not be created. Details: java.lang.IllegalStateException: UiAutomation not connected, UiAutomation@99b2847[id=-1, displayId=0, flags=0]' });
            }
            if (req.method === 'POST' && req.url === '/session') return send(200, { sessionId: 'abc', capabilities: json.capabilities.alwaysMatch });
            if (!req.url.startsWith('/session/abc')) return send(404, { error: 'invalid session id', message: 'A session is either terminated or not started' });
            if (u === '/appium/extensions') return send(200, { rest: { driver: { 'mobile: clickGesture': {} } } });
            if (u === '/screenshot') return send(200, 'iVBORw0KGgo=');
            if (u === '/window/rect') return send(200, { x: 0, y: 0, width: 1080, height: 2400 });
            if (u === '/source') return send(200, SOURCE);
            if (u === '/actions') return send(200, null);
            if (u === '/elements') return send(200, json.value === 'com.example.shop:id/add' ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'e1' }, { 'element-6066-11e4-a52e-4f735466cecf': 'e2' }] : []);
            if (u === '' && req.method === 'DELETE') return send(200, null);
            send(404, { error: 'unknown command', message: req.url });
        });
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, calls, port: server.address().port })));
}

const until = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const hit = posted.find(pred);
        if (hit) return hit;
        await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('timed out; posted: ' + posted.map(m => m.type).join(', '));
};

test('form, session, screen, tap, verify and end through the panel', async () => {
    const { server, calls, port } = await fakeAppium();
    config = { 'appium.port': port, autoRefreshAfterAction: false, adbPath: path.join(__dirname, 'fixtures', 'fake-adb.js') };
    const controller = new AppiumController();
    const context = { extensionUri: { fsPath: path.join(__dirname, '..') }, extensionPath: path.join(__dirname, '..'), globalState: { get: (_k, d) => d, update: () => Promise.resolve() } };
    try {
        await controller.checkServer();
        assert.strictEqual(controller.current.server.state, 'external');
        // a device as the device list would report it
        controller.update({ devices: [{ id: 'emulator-5554', name: 'Pixel 8', platform: 'android', kind: 'emulator', version: '15', state: 'ready' }] });
        InspectorPanel.show(context, controller, 'emulator-5554');
        await receive({ type: 'ready' });
        assert.ok(posted.some(m => m.type === 'environment' && m.devices.length === 1));
        assert.ok(posted.some(m => m.type === 'chooseDevice' && m.id === 'emulator-5554'));

        // installed apps and the launcher activity, through adb
        await receive({ type: 'listApps', deviceId: 'emulator-5554' });
        const apps = posted.filter(m => m.type === 'apps').pop();
        assert.ok(apps.apps.some(a => a.id === 'com.starlettech.letsbet.stage'), JSON.stringify(apps));
        await receive({ type: 'resolveActivity', deviceId: 'emulator-5554', package: 'com.starlettech.letsbet.stage' });
        assert.strictEqual(posted.filter(m => m.type === 'activity').pop().activity, 'com.starlettech.letsbet.ui.splash.SplashActivity');

        // an empty activity: the launcher activity from the device goes into the capabilities
        const letsbet = { deviceId: 'emulator-5554', app: { kind: 'installed', appPackage: 'com.starlettech.letsbet.stage', appActivity: '' }, extra: '' };
        await receive({ type: 'preview', form: letsbet });
        let p = posted.filter(m => m.type === 'preview').pop();
        assert.strictEqual(p.capabilities['appium:appActivity'], 'com.starlettech.letsbet.ui.splash.SplashActivity');
        assert.match(p.notes[0], /App activity from the device/);
        // a typed activity that is not the launcher: a warning, and the typed value is kept
        await receive({ type: 'preview', form: { ...letsbet, app: { ...letsbet.app, appActivity: '.MainActivity' } } });
        p = posted.filter(m => m.type === 'preview').pop();
        assert.strictEqual(p.capabilities['appium:appActivity'], '.MainActivity');
        assert.match(p.warnings[0], /starts com\.starlettech\.letsbet\.stage with com\.starlettech\.letsbet\.ui\.splash\.SplashActivity/);
        assert.deepStrictEqual(p.problems, []);

        // iOS: a busy WebDriverAgent port is swapped for a free one in the capabilities
        const blocker = require('node:net').createServer();
        const blocked = await new Promise(r => blocker.once('error', () => r(false)).listen(8100, '127.0.0.1', () => r(true)));
        controller.update({ devices: [...controller.current.devices, { id: '00008120-00042DC80EF8A01E', name: 'iPhone 15', platform: 'ios', kind: 'real', version: '26.5.2', state: 'ready' }] });
        config['ios.xcodeOrgId'] = 'ABCDE12345';
        await receive({ type: 'preview', form: { deviceId: '00008120-00042DC80EF8A01E', app: { kind: 'installed', bundleId: 'com.nesine.new-bet-dev' }, extra: '' } });
        const ios = posted.filter(m => m.type === 'preview').pop();
        assert.ok(ios.capabilities['appium:wdaLocalPort'] > 8100, JSON.stringify(ios.capabilities));
        assert.ok(ios.notes.some(n => /Port 8100 is in use, so WebDriverAgent uses \d+/.test(n)));
        await receive({ type: 'preview', form: { deviceId: '00008120-00042DC80EF8A01E', app: { kind: 'installed', bundleId: 'com.nesine.new-bet-dev' }, extra: '{"wdaLocalPort": 8100}' } });
        assert.strictEqual(posted.filter(m => m.type === 'preview').pop().capabilities['appium:wdaLocalPort'], 8100, 'a port the user set is kept');
        if (blocked) blocker.close();

        const form = { deviceId: 'emulator-5554', app: { kind: 'installed', appPackage: 'com.example.shop', appActivity: '' }, extra: '{"autoGrantPermissions": true}' };
        await receive({ type: 'preview', form });
        const preview = posted.filter(m => m.type === 'preview').pop();
        assert.deepStrictEqual(preview.problems, []);
        assert.strictEqual(preview.capabilities['appium:appPackage'], 'com.example.shop');
        assert.strictEqual(preview.capabilities['appium:autoGrantPermissions'], true);

        await receive({ type: 'preview', form: { ...form, app: { kind: 'installed', appPackage: '' } } });
        assert.match(posted.filter(m => m.type === 'preview').pop().problems[0], /app package/);

        await receive({ type: 'startSession', form });
        await until(m => m.type === 'screen');
        const created = calls.find(c => c.method === 'POST' && c.url === '/session').body.capabilities.alwaysMatch;
        assert.strictEqual(created['appium:udid'], 'emulator-5554');
        assert.strictEqual(created['appium:noReset'], true);
        assert.deepStrictEqual(created['appium:settings'], { waitForIdleTimeout: 300 }, 'fast start is on by default');
        assert.ok(!('appium:skipDeviceInitialization' in created) && !('appium:disableWindowAnimation' in created), 'fast start leaves the device alone');
        const screen = posted.find(m => m.type === 'screen');
        assert.strictEqual(screen.source, SOURCE);
        assert.ok(posted.findIndex(m => m.type === 'shot') < posted.findIndex(m => m.type === 'screen'), 'the picture comes first');
        assert.ok(posted.some(m => m.type === 'session' && m.device.id === 'emulator-5554'));

        await receive({ type: 'tap', x: 540, y: 786 });
        const actions = calls.filter(c => c.url === '/session/abc/actions' && c.method === 'POST').pop().body.actions[0].actions;
        assert.deepStrictEqual(actions[0], { type: 'pointerMove', duration: 0, origin: 'viewport', x: 540, y: 786 });

        await receive({ type: 'verify', key: 'k', locator: { using: 'id', value: 'com.example.shop:id/add' } });
        assert.deepStrictEqual(posted.filter(m => m.type === 'verified').pop(), { type: 'verified', key: 'k', count: 2 });

        await receive({ type: 'endSession' });
        assert.ok(calls.some(c => c.method === 'DELETE' && c.url === '/session/abc'));
        assert.ok(posted.some(m => m.type === 'sessionEnded'));

        await receive({ type: 'refresh' });
        assert.match(posted.filter(m => m.type === 'error').pop().message, /Start a session first/);
    } finally {
        controller.dispose();
        server.close();
    }
});

test('sameActivity: short, full and component names of one activity', () => {
    assert.ok(sameActivity('.Main', 'com.app.Main', 'com.app'));
    assert.ok(sameActivity('com.app/.Main', 'com.app.Main', 'com.app'));
    assert.ok(!sameActivity('.MainActivity', 'com.app.ui.splash.SplashActivity', 'com.app'));
});

test('Android: "UiAutomation not connected" frees UiAutomation on the device and starts the session again', async () => {
    const os = require('node:os');
    const { server, calls, port } = await fakeAppium({ uiAutomationBusy: 1 });
    const adbLog = path.join(os.tmpdir(), `fake-adb-${port}.log`);
    process.env.FAKE_ADB_LOG = adbLog;
    config = { 'appium.port': port, autoRefreshAfterAction: false, adbPath: path.join(__dirname, 'fixtures', 'fake-adb.js') };
    posted.length = 0;
    InspectorPanel.disposeCurrent();
    const controller = new AppiumController();
    const context = { extensionUri: { fsPath: path.join(__dirname, '..') }, extensionPath: path.join(__dirname, '..'), globalState: { get: (_k, d) => d, update: () => Promise.resolve() } };
    try {
        await controller.checkServer();
        controller.update({ devices: [{ id: 'emulator-5554', name: 'Pixel 10', platform: 'android', kind: 'emulator', version: '17', state: 'ready' }] });
        InspectorPanel.show(context, controller);
        await receive({ type: 'startSession', form: { deviceId: 'emulator-5554', app: { kind: 'none' }, extra: '' } });
        await until(m => m.type === 'screen');
        assert.strictEqual(calls.filter(c => c.method === 'POST' && c.url === '/session').length, 2, 'one retry');
        const adb = fs.readFileSync(adbLog, 'utf8');
        assert.match(adb, /am force-stop io\.appium\.uiautomator2\.server\.test/);
        assert.match(adb, /pkill -f uiautomator/);
        assert.doesNotMatch(adb, /uninstall/, 'the first step is enough here');
        assert.ok(!posted.some(m => m.type === 'error'), JSON.stringify(posted.filter(m => m.type === 'error')));
    } finally {
        delete process.env.FAKE_ADB_LOG;
        fs.rmSync(adbLog, { force: true });
        controller.dispose();
        server.close();
    }
});

test('Android: still not connected after freeing it, the UiAutomator2 server apps are reinstalled', async () => {
    const os = require('node:os');
    const { server, calls, port } = await fakeAppium({ uiAutomationBusy: 2 });
    const adbLog = path.join(os.tmpdir(), `fake-adb-${port}-2.log`);
    process.env.FAKE_ADB_LOG = adbLog;
    config = { 'appium.port': port, autoRefreshAfterAction: false, adbPath: path.join(__dirname, 'fixtures', 'fake-adb.js') };
    posted.length = 0;
    InspectorPanel.disposeCurrent();
    const controller = new AppiumController();
    const context = { extensionUri: { fsPath: path.join(__dirname, '..') }, extensionPath: path.join(__dirname, '..'), globalState: { get: (_k, d) => d, update: () => Promise.resolve() } };
    try {
        await controller.checkServer();
        controller.update({ devices: [{ id: 'emulator-5554', name: 'Pixel 10', platform: 'android', kind: 'emulator', version: '17', state: 'ready' }] });
        InspectorPanel.show(context, controller);
        await receive({ type: 'startSession', form: { deviceId: 'emulator-5554', app: { kind: 'none' }, extra: '' } });
        await until(m => m.type === 'screen');
        assert.strictEqual(calls.filter(c => c.method === 'POST' && c.url === '/session').length, 3, 'two retries');
        const adb = fs.readFileSync(adbLog, 'utf8');
        assert.match(adb, /uninstall io\.appium\.uiautomator2\.server\.test/);
        assert.match(adb, /uninstall io\.appium\.uiautomator2\.server\n/);
        assert.doesNotMatch(adb, /uninstall (?!io\.appium\.uiautomator2)/, 'the user\'s apps are left alone');
        assert.ok(!posted.some(m => m.type === 'error'), JSON.stringify(posted.filter(m => m.type === 'error')));
    } finally {
        delete process.env.FAKE_ADB_LOG;
        fs.rmSync(adbLog, { force: true });
        controller.dispose();
        server.close();
    }
});
