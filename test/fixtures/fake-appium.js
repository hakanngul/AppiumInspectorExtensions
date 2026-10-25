#!/usr/bin/env node
// A stand-in for the appium CLI: `--version`, `driver list --installed --json` and `server --address --port [--base-path]`.
// FAKE_APPIUM_MODE: crash (exit at once with a message), busy (EADDRINUSE), slow (never listens).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mode = process.env.FAKE_APPIUM_MODE || '';
const opt = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };

if (args[0] === '--version') {
    console.log('3.8.0');
} else if (args[0] === 'driver' && args[1] === 'list') {
    console.error('- Listing installed drivers');
    process.stdout.write(fs.readFileSync(path.join(__dirname, 'appium-driver-list.json'), 'utf8'));
} else if (args[0] === 'server') {
    if (process.env.FAKE_APPIUM_ARGS) fs.writeFileSync(process.env.FAKE_APPIUM_ARGS, JSON.stringify(args));
    if (mode === 'crash') {
        console.error('[Appium] Could not start: fake failure');
        process.exit(1);
    }
    if (mode === 'busy') {
        console.error('Error: listen EADDRINUSE: address already in use 127.0.0.1:' + opt('--port'));
        process.exit(1);
    }
    if (mode !== 'slow') {
        const base = (opt('--base-path') || '').replace(/\/+$/, '');
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            if (req.url === base + '/status') {
                res.end(JSON.stringify({ value: { ready: true, message: 'The server is ready to accept new connections', build: { version: '3.8.0' } } }));
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ value: { error: 'unknown command', message: 'not found', stacktrace: '' } }));
            }
        });
        setTimeout(() => server.listen(Number(opt('--port')), opt('--address'), () => console.log('[Appium] Appium REST http interface listener started')), 200);
    }
    setInterval(() => undefined, 1000);
    process.on('SIGTERM', () => { console.log('[Appium] Received SIGTERM - shutting down'); process.exit(0); });
} else {
    console.error('fake appium: unknown arguments ' + args.join(' '));
    process.exit(2);
}
