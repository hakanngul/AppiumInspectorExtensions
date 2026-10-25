// Renders the sidebar outside VS Code with sample states and saves screenshots: node test/preview.js [outDir]
// Uses the Playwright that is installed on the machine; not part of npm test.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const media = path.join(__dirname, '..', 'media');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'preview'));
fs.mkdirSync(out, { recursive: true });

const devices = [
    { id: 'emulator-5554', name: 'Pixel 8 API 35', platform: 'android', kind: 'emulator', version: '15', state: 'ready' },
    { id: '0123456789ABCDEF', name: '0123456789ABCDEF', platform: 'android', kind: 'real', state: 'unauthorized', reason: 'Allow USB debugging on the device, then reload.' },
    { id: '5F0C9F3E-1F2B-4C7D-9A1E-0B6B2E3D4A51', name: 'iPhone 17', platform: 'ios', kind: 'simulator', version: '26.0', state: 'ready' },
    { id: '8A1D2C3B-4E5F-4061-8273-94A5B6C7D8E9', name: 'iPhone 17 Pro', platform: 'ios', kind: 'simulator', version: '26.0', state: 'shutdown' },
    { id: '00008140-001A2B3C4D5E801E', name: "Hakan's iPhone", platform: 'ios', kind: 'real', version: '26.0.1', state: 'ready' },
];
const base = {
    busy: false, appiumVersion: '3.8.0', platform: 'darwin', devicesLoading: false, deviceNotes: [], devices,
    drivers: [{ name: 'uiautomator2', version: '8.7.0', automationName: 'UiAutomator2', platforms: ['Android'] }],
    ports: [
        { port: 4723, pid: 412, command: 'node', label: 'Appium server', own: true },
        { port: 8100, pid: 8811, command: 'xcodebuild', label: 'WebDriverAgent (iOS)', own: false },
    ],
};
const states = {
    running: { ...base, server: { state: 'running', url: 'http://127.0.0.1:4723', version: '3.8.0', message: '' } },
    stopped: { ...base, server: { state: 'stopped', url: 'http://127.0.0.1:4723', version: '', message: '' }, error: 'Appium exited before it was ready: port 4723 is already in use. Free it or set testflyAppiumInspector.appium.port.' },
    'no-tools': { ...base, platform: 'linux', appiumVersion: undefined, drivers: undefined, driversError: 'Appium was not found (appium). Install Appium 3 with "npm install -g appium" (Node 20.19+, 22.12+ or 24+) or set testflyAppiumInspector.appium.path.', devices: [], deviceNotes: ['adb was not found: install Android platform-tools, set ANDROID_HOME, or set testflyAppiumInspector.adbPath.', 'iOS needs macOS with Xcode.'], server: { state: 'stopped', url: 'http://127.0.0.1:4723', version: '', message: '' } },
};

function page(state, theme) {
    const css = ['inspector.css', 'sidebar.css'].map(f => fs.readFileSync(path.join(media, f), 'utf8')).join('\n');
    const vars = theme === 'light'
        ? ':root{--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f3f3f3;--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-input-background:#ffffff;--vscode-input-border:#cecece;--vscode-button-secondaryBackground:#e5e5e5;--vscode-panel-border:#e5e5e5;--vscode-badge-background:#cccccc;--vscode-badge-foreground:#333}'
        : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}${vars} body{background:${theme === 'light' ? '#f3f3f3' : '#181818'};width:300px}</style></head>
<body>${fs.readFileSync(path.join(media, 'sidebar-body.html'), 'utf8')}
<script>window.acquireVsCodeApi=()=>({postMessage(m){ if(m.type==='ready') setTimeout(()=>window.postMessage({type:'state',state:${JSON.stringify(state)},url:'http://127.0.0.1:4723'},'*')); },getState(){},setState(){}});</script>
<script>${fs.readFileSync(path.join(media, 'sidebar.js'), 'utf8')}</script></body></html>`;
}

(async () => {
    const browser = await chromium.launch();
    const errors = [];
    try {
        for (const [name, state] of Object.entries(states)) {
            for (const theme of ['dark', 'light']) {
                const p = await browser.newPage({ viewport: { width: 300, height: 760 } });
                p.on('pageerror', e => errors.push(`${name}/${theme}: ${e.message}`));
                await p.setContent(page(state, theme));
                await p.waitForTimeout(150);
                const file = path.join(out, `sidebar-${name}-${theme}.png`);
                await p.screenshot({ path: file, fullPage: true });
                console.log(file);
                await p.close();
            }
        }
    } finally {
        await browser.close();
    }
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exit(1);
    }
})();
