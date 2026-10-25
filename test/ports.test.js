const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseLsof, parseNetstat, watchedPorts, labelFor, isPortFree, firstFreePort, stopProcess, listListeners } = require('../out/ports.js');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('lsof -F pcn: one row per process and port, IPv4 and IPv6 merged', () => {
    assert.deepStrictEqual(parseLsof(fixture('lsof-listen.txt')), [
        { port: 4723, pid: 412, command: 'Appium' },
        { port: 8100, pid: 8811, command: 'xcodebuild' },
        { port: 9100, pid: 933, command: 'node' },
        { port: 49152, pid: 77, command: 'rapportd' },
    ]);
    assert.deepStrictEqual(parseLsof(''), []);
});

test('netstat -ano (Windows): listening rows only, names from tasklist', () => {
    const tasklist = '"System Idle Process","0","Services","0","8 K"\n"node.exe","5520","Console","1","80,000 K"\n"java.exe","7712","Console","1","90,000 K"\n';
    assert.deepStrictEqual(parseNetstat(fixture('netstat-ano.txt'), tasklist), [
        { port: 135, pid: 1032, command: '' },
        { port: 4723, pid: 5520, command: 'node.exe' },
        { port: 8200, pid: 7712, command: 'java.exe' },
    ]);
});

test('Appium ports are labelled; others are not', () => {
    const w = watchedPorts(4724);
    assert.strictEqual(labelFor(4724, w), 'Appium server');
    assert.strictEqual(labelFor(4723, w), undefined, 'only the configured server port');
    assert.strictEqual(labelFor(8105, w), 'WebDriverAgent (iOS)');
    assert.strictEqual(labelFor(9100, w), 'MJPEG screen stream (iOS)');
    assert.strictEqual(labelFor(8250, w), 'UiAutomator2 server (Android)');
    assert.strictEqual(labelFor(49152, w), undefined);
});

test('a real listener: found, the port reported busy, the next one free, stopped on request', { skip: process.platform === 'win32' }, async () => {
    const holder = await new Promise(r => net.createServer().listen(0, '127.0.0.1', function () { r(this); }));
    const port = holder.address().port;
    holder.close();
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port}, '127.0.0.1', () => console.log('up')); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise(r => child.stdout.once('data', r));
    try {
        assert.strictEqual(await isPortFree(port), false);
        const free = await firstFreePort(port, port + 20);
        assert.ok(free > port, `next free port after ${port}: ${free}`);
        const uses = await listListeners();
        assert.ok(uses.some(u => u.port === port && u.pid === child.pid), 'lsof sees the listener');
        await stopProcess(child.pid, 2000);
        assert.ok(await isPortFree(port));
    } finally {
        child.kill('SIGKILL');
    }
    await assert.rejects(stopProcess(process.pid), /VS Code itself/);
});
