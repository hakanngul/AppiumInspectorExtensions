const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchFor, quoteWindows, resolveExecutable, run, start, killTree, ToolNotFoundError } = require('../out/process.js');

test('Windows: the appium .cmd shim runs its entry point with node; other .cmd files go through the shell', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-'));
    const shim = path.join(dir, 'appium.cmd');
    fs.mkdirSync(path.join(dir, 'node_modules', 'appium'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'appium', 'index.js'), '');
    try {
        assert.deepStrictEqual(launchFor(shim, ['server', '--port', '4723'], 'win32'),
            { file: 'node', args: [path.join(dir, 'node_modules', 'appium', 'index.js'), 'server', '--port', '4723'], shell: false });
        assert.deepStrictEqual(launchFor('C:\\Program Files\\tools\\other.cmd', ['a b', 'c'], 'win32'),
            { file: '"C:\\Program Files\\tools\\other.cmd"', args: ['"a b"', 'c'], shell: true });
        assert.deepStrictEqual(launchFor('/usr/local/bin/appium', ['--version'], 'darwin'), { file: '/usr/local/bin/appium', args: ['--version'], shell: false });
        assert.throws(() => quoteWindows('x & calc'), /Unsafe character/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('resolveExecutable finds a tool on PATH or by path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
    const tool = path.join(dir, process.platform === 'win32' ? 'tool.exe' : 'tool');
    fs.writeFileSync(tool, '');
    try {
        assert.strictEqual(resolveExecutable('tool', { PATH: dir, PATHEXT: '.EXE' }), tool);
        assert.strictEqual(resolveExecutable(tool, {}), tool);
        assert.strictEqual(resolveExecutable('missing-tool', { PATH: dir }), undefined);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('run: output, failures with stderr, missing tools', async () => {
    const node = process.execPath;
    assert.strictEqual((await run(node, ['-e', 'console.log("hi")'])).stdout.trim(), 'hi');
    await assert.rejects(run(node, ['-e', 'console.error("bad thing"); process.exit(3)']), /failed: bad thing/);
    await assert.rejects(run('/nonexistent/tool', []), e => e instanceof ToolNotFoundError);
});

test('killTree stops a process and the children it started', { skip: process.platform === 'win32' }, async () => {
    const script = 'const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log(c.pid);setInterval(()=>{},1000)';
    const child = await start(process.execPath, ['-e', script]);
    const grandchild = await new Promise(resolve => child.stdout.once('data', d => resolve(Number(String(d).trim()))));
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.ok(alive(grandchild));
    await killTree(child, 2_000);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    for (let i = 0; i < 20 && alive(grandchild); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(!alive(grandchild), 'the grandchild is gone too');
});
