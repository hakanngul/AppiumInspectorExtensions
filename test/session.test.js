const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { AppiumClient, ELEMENT_KEY } = require('../out/appium/client.js');
const { InspectorSession } = require('../out/appium/session.js');
const { tapActions, swipeVector, mobile } = require('../out/appium/gestures.js');

const android = { id: 'emulator-5554', name: 'Pixel 8', platform: 'android', kind: 'emulator', state: 'ready' };
const ios = { id: 'SIM-1', name: 'iPhone 17', platform: 'ios', kind: 'simulator', state: 'ready' };

/** A W3C server for one session; `actions` decides whether W3C actions are accepted. */
function fakeAppium({ actions = true, extensions = ['mobile: clickGesture'] } = {}) {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
            const json = body ? JSON.parse(body) : undefined;
            calls.push({ method: req.method, url: req.url, body: json });
            const send = (status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ value })); };
            const u = req.url.replace('/session/s1', '');
            if (req.method === 'POST' && req.url === '/session') return send(200, { sessionId: 's1', capabilities: { platformName: 'Android' } });
            if (u === '/appium/extensions') return send(200, { rest: { driver: Object.fromEntries(extensions.map(e => [e, {}])) } });
            if (u === '/screenshot') return send(200, 'iVBOR');
            if (u === '/window/rect') return send(200, { x: 0, y: 0, width: 1080, height: 2400 });
            if (u === '/source') return send(200, '<hierarchy><a text="x\u0001"/></hierarchy>');
            if (u === '/actions' && req.method === 'POST') return actions ? send(200, null) : send(404, { error: 'unknown command', message: 'no actions' });
            if (u === '/actions') return send(200, null);
            if (u === '/execute/sync') return send(200, null);
            if (u === '/back') return send(200, null);
            if (u === '/elements') return send(200, json.value === 'none' ? [] : [{ [ELEMENT_KEY]: 'e1' }]);
            if (u === '/element/e1/value') return send(200, null);
            if (u === '/element/e1/rect') return send(200, { x: 1, y: 2, width: 3, height: 4 });
            if (u === '' && req.method === 'DELETE') return send(200, null);
            send(404, { error: 'unknown command', message: req.url });
        });
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, calls, client: new AppiumClient(`http://127.0.0.1:${server.address().port}`) })));
}

test('capture: screenshot first, then window and sanitised source', async () => {
    const { server, calls, client } = await fakeAppium();
    try {
        const s = await InspectorSession.open(client, android, { platformName: 'Android' });
        let shot;
        const c = await s.capture(x => (shot = x));
        assert.strictEqual(shot, 'data:image/png;base64,iVBOR');
        assert.deepStrictEqual(c.window, { x: 0, y: 0, width: 1080, height: 2400 });
        assert.strictEqual(c.source, '<hierarchy><a text="x"/></hierarchy>');
        const order = calls.map(x => x.url.replace('/session/s1', '')).filter(u => ['/screenshot', '/window/rect', '/source'].includes(u));
        assert.deepStrictEqual(order, ['/screenshot', '/window/rect', '/source']);
        await s.close();
        assert.ok(s.isClosed);
        assert.ok(calls.some(x => x.method === 'DELETE' && x.url === '/session/s1'));
    } finally {
        server.close();
    }
});

test('gestures go through W3C actions; a refused action falls back to mobile:', async () => {
    const ok = await fakeAppium();
    try {
        const s = await InspectorSession.open(ok.client, android, {});
        await s.tap({ x: 10.4, y: 20.6 });
        const sent = ok.calls.find(x => x.url.endsWith('/actions') && x.method === 'POST').body.actions;
        assert.deepStrictEqual(sent, tapActions({ x: 10, y: 21 }));
        assert.strictEqual(sent[0].parameters.pointerType, 'touch');
        assert.ok(ok.calls.some(x => x.url.endsWith('/actions') && x.method === 'DELETE'), 'actions released');
    } finally {
        ok.server.close();
    }
    const refused = await fakeAppium({ actions: false });
    try {
        const s = await InspectorSession.open(refused.client, android, {});
        await s.tap({ x: 5, y: 6 });
        assert.deepStrictEqual(refused.calls.find(x => x.url.endsWith('/execute/sync')).body, { script: 'mobile: clickGesture', args: [{ x: 5, y: 6 }] });
    } finally {
        refused.server.close();
    }
});

test('type: into the found element, or into the focused field with mobile: type / mobile: keys', async () => {
    const { server, calls, client } = await fakeAppium();
    try {
        const s = await InspectorSession.open(client, android, {});
        await s.type('ada', { using: 'id', value: 'email' });
        assert.deepStrictEqual(calls.find(x => x.url.endsWith('/element/e1/value')).body, { text: 'ada' });
        await s.type('bob', { using: 'id', value: 'none' });
        assert.deepStrictEqual(calls.filter(x => x.url.endsWith('/execute/sync')).pop().body, { script: 'mobile: type', args: [{ text: 'bob' }] });
        const i = await InspectorSession.open(client, ios, {});
        await i.type('cem');
        assert.deepStrictEqual(calls.filter(x => x.url.endsWith('/execute/sync')).pop().body, { script: 'mobile: keys', args: [{ keys: ['cem'] }] });
        await i.home();
        assert.deepStrictEqual(calls.filter(x => x.url.endsWith('/execute/sync')).pop().body, { script: 'mobile: pressButton', args: [{ name: 'home' }] });
        assert.deepStrictEqual(await s.find({ using: 'id', value: 'email' }), [{ x: 1, y: 2, width: 3, height: 4 }]);
        assert.strictEqual(await s.count({ using: 'id', value: 'none' }), 0);
    } finally {
        server.close();
    }
});

test('swipe vectors and mobile: commands per platform', () => {
    assert.deepStrictEqual(swipeVector({ width: 1000, height: 2000 }, 'up'), [{ x: 500, y: 1500 }, { x: 500, y: 500 }]);
    assert.deepStrictEqual(swipeVector({ width: 1000, height: 2000 }, 'right'), [{ x: 250, y: 1000 }, { x: 750, y: 1000 }]);
    assert.deepStrictEqual(mobile.longPress('android', { x: 1, y: 2 }), { script: 'mobile: longClickGesture', args: { x: 1, y: 2, duration: 800 } });
    assert.deepStrictEqual(mobile.longPress('ios', { x: 1, y: 2 }), { script: 'mobile: touchAndHold', args: { x: 1, y: 2, duration: 0.8 } });
    assert.deepStrictEqual(mobile.swipe('ios', { x: 1, y: 2 }, { x: 3, y: 4 }), { script: 'mobile: dragFromToForDuration', args: { fromX: 1, fromY: 2, toX: 3, toY: 4, duration: 0.3 } });
    assert.deepStrictEqual(mobile.home('android'), { script: 'mobile: pressKey', args: { keycode: 3 } });
});
