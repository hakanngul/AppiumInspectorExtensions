const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { AppiumServer, serverArgs, validateOptions, parseDriverList } = require('../out/appium/server.js');
const { AppiumClient } = require('../out/appium/client.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-appium.js');
const posix = process.platform !== 'win32';

function freePort() {
    return new Promise(resolve => {
        const s = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

function options(port, extra = {}) {
    return { appiumPath: FAKE, host: '127.0.0.1', port, basePath: '/', allowCors: true, ...extra };
}

function withMode(mode, fn) {
    return async () => {
        const before = process.env.FAKE_APPIUM_MODE;
        process.env.FAKE_APPIUM_MODE = mode;
        try {
            await fn();
        } finally {
            if (before === undefined) delete process.env.FAKE_APPIUM_MODE; else process.env.FAKE_APPIUM_MODE = before;
        }
    };
}

test('serverArgs uses only Appium 3 flags; base path and CORS are optional', () => {
    assert.deepStrictEqual(serverArgs(options(4723)), ['server', '--address', '127.0.0.1', '--port', '4723', '--allow-cors']);
    assert.deepStrictEqual(serverArgs(options(4724, { basePath: '/wd/hub/', allowCors: false })),
        ['server', '--address', '127.0.0.1', '--port', '4724', '--base-path', '/wd/hub']);
});

test('validateOptions refuses values that could reach a shell', () => {
    assert.doesNotThrow(() => validateOptions(options(4723)));
    assert.throws(() => validateOptions(options(4723, { host: '127.0.0.1 & calc' })), /Invalid Appium host/);
    assert.throws(() => validateOptions(options(0)), /Invalid Appium port/);
    assert.throws(() => validateOptions(options(4723, { basePath: '/wd;rm' })), /Invalid Appium base path/);
    assert.throws(() => validateOptions(options(4723, { appiumPath: ' ' })), /appium.path is empty/);
});

test('parseDriverList reads the real Appium 3.8 JSON, also with log lines around it', () => {
    const json = fs.readFileSync(path.join(__dirname, 'fixtures', 'appium-driver-list.json'), 'utf8');
    const expected = [{ name: 'uiautomator2', version: '8.7.0', automationName: 'UiAutomator2', platforms: ['Android'] }];
    assert.deepStrictEqual(parseDriverList(json), expected);
    assert.deepStrictEqual(parseDriverList('- Listing installed drivers\n' + json + '\n'), expected);
    assert.deepStrictEqual(parseDriverList('{}'), []);
    assert.deepStrictEqual(parseDriverList(''), []);
});

test('start, check, stop: the server this extension starts', { skip: !posix }, async () => {
    const port = await freePort();
    const argsFile = path.join(os.tmpdir(), `fake-appium-args-${port}.json`);
    process.env.FAKE_APPIUM_ARGS = argsFile;
    const states = [];
    const log = [];
    const server = new AppiumServer(options(port, { basePath: '/wd/hub', env: { APPIUM_XCUITEST_PREFER_DEVICECTL: '1' } }), l => log.push(l), i => states.push(i.state));
    try {
        const info = await server.start(10_000);
        assert.strictEqual(info.state, 'running');
        assert.strictEqual(info.version, '3.8.0');
        assert.strictEqual(info.url, `http://127.0.0.1:${port}/wd/hub`);
        assert.ok(server.owned);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')),
            ['server', '--address', '127.0.0.1', '--port', String(port), '--base-path', '/wd/hub', '--allow-cors']);
        assert.ok(log.some(l => /listener started/.test(l)), 'server output reaches the log');
        assert.strictEqual(JSON.parse(fs.readFileSync(argsFile + '.env', 'utf8')).APPIUM_XCUITEST_PREFER_DEVICECTL, '1', 'extra env reaches the server');
        assert.strictEqual((await server.start()).state, 'running', 'a second start keeps the running server');

        const stopped = await server.stop();
        assert.strictEqual(stopped.state, 'stopped');
        assert.ok(!server.owned);
        await assert.rejects(new AppiumClient(server.url).status(500), e => e.unreachable);
        assert.deepStrictEqual(states.filter((s, i) => s !== states[i - 1]), ['stopped', 'starting', 'running', 'stopping', 'stopped']);
    } finally {
        delete process.env.FAKE_APPIUM_ARGS;
        fs.rmSync(argsFile, { force: true });
        fs.rmSync(argsFile + '.env', { force: true });
        server.dispose();
    }
});

test('a server started elsewhere is used and never stopped', { skip: !posix }, async () => {
    const port = await freePort();
    const other = new AppiumServer(options(port));
    await other.start(10_000);
    try {
        const ours = new AppiumServer(options(port, { appiumPath: '/nonexistent/appium' }));
        assert.strictEqual((await ours.check()).state, 'external');
        assert.strictEqual((await ours.start()).state, 'external', 'start does not spawn a second server');
        assert.strictEqual((await ours.stop()).state, 'external', 'stop leaves it running');
        assert.strictEqual((await other.check()).state, 'running');
    } finally {
        await other.stop();
    }
});

test('a missing appium is reported with install help', async () => {
    const server = new AppiumServer(options(await freePort(), { appiumPath: '/nonexistent/appium' }));
    await assert.rejects(server.start(2_000), /Appium was not found \(\/nonexistent\/appium\)\. Install Appium 3/);
    assert.strictEqual(server.current.state, 'stopped');
    await assert.rejects(server.version(), /Appium was not found/);
});

test('Appium that exits at once: the reason comes from its output', { skip: !posix }, withMode('crash', async () => {
    const server = new AppiumServer(options(await freePort()));
    await assert.rejects(server.start(5_000), /exited before it was ready: \[Appium\] Could not start: fake failure/);
    assert.strictEqual(server.current.state, 'stopped');
}));

test('a port in use is named as such', { skip: !posix }, withMode('busy', async () => {
    const port = await freePort();
    const server = new AppiumServer(options(port));
    await assert.rejects(server.start(5_000), new RegExp(`port ${port} is already in use`));
}));

test('something that is not Appium on the port is reported, nothing is started', async () => {
    const http = require('node:http');
    const port = await freePort();
    const squatter = http.createServer((_, res) => { res.statusCode = 404; res.end('{"value":{"error":"x","message":"nope"}}'); });
    await new Promise(r => squatter.listen(port, '127.0.0.1', r));
    try {
        const server = new AppiumServer(options(port));
        await assert.rejects(server.start(2_000), new RegExp(`not Appium answers.*Free port ${port}`));
        assert.ok(!server.owned);
    } finally {
        squatter.close();
    }
});

test('a server that never gets ready is killed after the timeout', { skip: !posix }, withMode('slow', async () => {
    const server = new AppiumServer(options(await freePort()));
    await assert.rejects(server.start(1_500), /did not become ready .* within 2 s/);
    assert.ok(!server.owned);
}));

test('version and drivers come from the Appium CLI', async () => {
    const server = new AppiumServer(options(4723));
    assert.strictEqual(await server.version(), '3.8.0');
    assert.deepStrictEqual((await server.drivers()).map(d => `${d.name}@${d.version}`), ['uiautomator2@8.7.0']);
});

// Against a real Appium 3 installation: TESTFLY_REAL_APPIUM=/path/to/appium npm test
test('real Appium: start, /status, stop', { skip: !process.env.TESTFLY_REAL_APPIUM || !posix }, async () => {
    const port = await freePort();
    const log = [];
    const server = new AppiumServer(options(port, { appiumPath: process.env.TESTFLY_REAL_APPIUM }), l => log.push(l));
    try {
        const info = await server.start(60_000);
        assert.strictEqual(info.state, 'running');
        assert.match(info.version, /^3\./);
        assert.strictEqual((await server.stop()).state, 'stopped');
        await assert.rejects(new AppiumClient(server.url).status(500), e => e.unreachable);
    } finally {
        server.dispose();
    }
});
