const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { AppiumClient, AppiumError, ELEMENT_KEY, serverUrl } = require('../out/appium/client.js');

/** A tiny W3C server: handlers by "METHOD path"; records every request. */
function fakeServer(handlers) {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
            const key = `${req.method} ${req.url}`;
            calls.push({ key, body: body ? JSON.parse(body) : undefined });
            const h = handlers[key];
            res.setHeader('Content-Type', 'application/json');
            if (!h) {
                res.statusCode = 404;
                res.end(JSON.stringify({ value: { error: 'unknown command', message: `No route ${key}`, stacktrace: 'at router' } }));
                return;
            }
            const [status, value] = h(body ? JSON.parse(body) : undefined);
            res.statusCode = status;
            if (value === 'HANG') return; // never answers
            res.end(typeof value === 'string' && value.startsWith('RAW:') ? value.slice(4) : JSON.stringify({ value }));
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test('status, session, source, screenshot, rect, actions, execute, back, elements, value, settings', async () => {
    const S = '/session/abc';
    const { server, calls, url } = await fakeServer({
        'GET /wd/hub/status': () => [200, { ready: true, message: 'The server is ready to accept new connections', build: { version: '3.8.0' } }],
        'POST /wd/hub/session': () => [200, { sessionId: 'abc', capabilities: { platformName: 'Android' } }],
        [`GET /wd/hub${S}/source`]: () => [200, '<hierarchy/>'],
        [`GET /wd/hub${S}/screenshot`]: () => [200, 'iVBORw0K'],
        [`GET /wd/hub${S}/window/rect`]: () => [200, { x: 0, y: 0, width: 1080, height: 2400 }],
        [`POST /wd/hub${S}/actions`]: () => [200, null],
        [`DELETE /wd/hub${S}/actions`]: () => [200, null],
        [`POST /wd/hub${S}/execute/sync`]: () => [200, true],
        [`POST /wd/hub${S}/back`]: () => [200, null],
        [`POST /wd/hub${S}/elements`]: b => [200, b.value === 'none' ? [] : [{ [ELEMENT_KEY]: 'e1' }, { [ELEMENT_KEY]: 'e2' }]],
        [`POST /wd/hub${S}/element/e1/value`]: () => [200, null],
        [`GET /wd/hub${S}/appium/settings`]: () => [200, { snapshotMaxDepth: 50 }],
        [`POST /wd/hub${S}/appium/settings`]: () => [200, null],
        [`GET /wd/hub${S}/appium/extensions`]: () => [200, { rest: { driver: { 'mobile: clickGesture': {}, 'mobile: dragGesture': {} }, plugins: { images: { 'mobile: compareImages': {} } } } }],
        [`DELETE /wd/hub${S}`]: () => [200, null],
    });
    try {
        const c = new AppiumClient(url + '/wd/hub/');
        assert.deepStrictEqual(await c.status(), { ready: true, message: 'The server is ready to accept new connections', version: '3.8.0' });
        const s = await c.createSession({ platformName: 'Android', 'appium:udid': 'emulator-5554' });
        assert.strictEqual(s.sessionId, 'abc');
        assert.deepStrictEqual(calls.find(x => x.key === 'POST /wd/hub/session').body,
            { capabilities: { alwaysMatch: { platformName: 'Android', 'appium:udid': 'emulator-5554' }, firstMatch: [{}] } });
        assert.strictEqual(await c.source('abc'), '<hierarchy/>');
        assert.strictEqual(await c.screenshot('abc'), 'data:image/png;base64,iVBORw0K');
        assert.deepStrictEqual(await c.windowRect('abc'), { x: 0, y: 0, width: 1080, height: 2400 });
        await c.performActions('abc', [{ type: 'pointer', id: 'finger', actions: [] }]);
        await c.releaseActions('abc');
        assert.strictEqual(await c.executeScript('abc', 'mobile: clickGesture', { x: 10, y: 20 }), true);
        assert.deepStrictEqual(calls.find(x => x.key.endsWith('/execute/sync')).body, { script: 'mobile: clickGesture', args: [{ x: 10, y: 20 }] });
        await c.back('abc');
        assert.deepStrictEqual(await c.findElements('abc', 'id', 'com.app:id/go'), ['e1', 'e2']);
        assert.deepStrictEqual(await c.findElements('abc', 'xpath', 'none'), []);
        await c.setValue('abc', 'e1', 'ada');
        assert.deepStrictEqual(calls.find(x => x.key.endsWith('/value')).body, { text: 'ada' });
        assert.deepStrictEqual(await c.getSettings('abc'), { snapshotMaxDepth: 50 });
        await c.updateSettings('abc', { snapshotMaxDepth: 60 });
        assert.deepStrictEqual([...(await c.extensionNames('abc'))].sort(), ['mobile: clickGesture', 'mobile: compareImages', 'mobile: dragGesture']);
        await c.deleteSession('abc');
    } finally {
        server.close();
    }
});

test('W3C errors keep error, message and stacktrace; no such element means no match; invalid session is recognised', async () => {
    const { server, url } = await fakeServer({
        'POST /session': () => [500, { error: 'session not created', message: 'Could not find a connected Android device', stacktrace: 'at createSession' }],
        'POST /session/x/elements': () => [404, { error: 'no such element', message: 'none', stacktrace: '' }],
        'GET /session/gone/source': () => [404, { error: 'invalid session id', message: 'A session is either terminated or not started', stacktrace: '' }],
        'GET /broken': () => [502, 'RAW:<html>bad gateway</html>'],
    });
    try {
        const c = new AppiumClient(url);
        await assert.rejects(c.createSession({}), e => e instanceof AppiumError && e.error === 'session not created'
            && e.message === 'Could not find a connected Android device' && e.stacktrace === 'at createSession' && e.httpStatus === 500 && !e.unreachable);
        assert.deepStrictEqual(await c.findElements('x', 'id', 'missing'), []);
        await assert.rejects(c.source('gone'), e => e instanceof AppiumError && e.invalidSession);
        await assert.rejects(c.request('GET', '/broken'), e => e instanceof AppiumError && /HTTP 502 without a JSON body/.test(e.message));
        await assert.rejects(c.request('GET', '/nothing'), e => e instanceof AppiumError && e.error === 'unknown command');
    } finally {
        server.close();
    }
});

test('unreachable and timed out are told apart', async () => {
    await assert.rejects(new AppiumClient('http://127.0.0.1:1').status(), e => e instanceof AppiumError && e.unreachable && !e.timedOut && /not reachable/.test(e.message));
    const { server, url } = await fakeServer({ 'GET /status': () => [200, 'HANG'] });
    try {
        await assert.rejects(new AppiumClient(url).status(300), e => e instanceof AppiumError && e.timedOut && !e.unreachable);
    } finally {
        server.closeAllConnections();
        server.close();
    }
});

test('serverUrl builds the address Appium listens on', () => {
    assert.strictEqual(serverUrl('127.0.0.1', 4723), 'http://127.0.0.1:4723');
    assert.strictEqual(serverUrl('127.0.0.1', 4723, '/'), 'http://127.0.0.1:4723');
    assert.strictEqual(serverUrl('localhost', 4724, 'wd/hub/'), 'http://localhost:4724/wd/hub');
    assert.strictEqual(serverUrl('::1', 4723), 'http://[::1]:4723');
});
