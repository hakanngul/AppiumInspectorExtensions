// Drives the inspector webview outside VS Code with a fake host and the fixture page sources, checks what it shows,
// and saves screenshots: node test/preview-inspector.js [outDir]. Uses the machine's Playwright; not part of npm test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { chromium } = require('playwright');

const media = path.join(__dirname, '..', 'media');
const fixtures = path.join(__dirname, 'fixtures');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'preview'));
fs.mkdirSync(out, { recursive: true });
const read = f => fs.readFileSync(path.join(media, f), 'utf8');

const devices = [
    { id: 'emulator-5554', name: 'Pixel 8 API 35', platform: 'android', kind: 'emulator', version: '15', state: 'ready' },
    { id: '5F0C9F3E-1F2B-4C7D-9A1E-0B6B2E3D4A51', name: 'iPhone 17', platform: 'ios', kind: 'simulator', version: '26.0', state: 'ready' },
    { id: '8A1D2C3B-4E5F-4061-8273-94A5B6C7D8E9', name: 'iPhone 17 Pro', platform: 'ios', kind: 'simulator', version: '26.0', state: 'shutdown' },
];
const environment = { type: 'environment', server: { state: 'running', url: 'http://127.0.0.1:4723', version: '3.8.0', message: '' }, busy: false, devices, devicesLoading: false, platform: 'darwin' };

/** A screenshot drawn from the fixture: every element with a text or label, at its rectangle. */
async function fakeScreenshot(browser, source, platform, width, height, scale) {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await p.setContent(`<body style="margin:0;background:#f5f6f8;font:16px system-ui"><script>
        const doc = new DOMParser().parseFromString(${JSON.stringify(source)}, 'text/xml');
        for (const n of doc.querySelectorAll('*')) {
            let r;
            if (${JSON.stringify(platform)} === 'android') { const m = /\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]/.exec(n.getAttribute('bounds') || ''); if (!m) continue; r = [m[1]/${scale}, m[2]/${scale}, (m[3]-m[1])/${scale}, (m[4]-m[2])/${scale}]; }
            else { if (!n.getAttribute('width') || n.getAttribute('visible') === 'false') continue; r = ['x','y','width','height'].map(k => +n.getAttribute(k)); }
            const text = n.getAttribute('text') || n.getAttribute('label') || n.getAttribute('hint') || n.getAttribute('placeholderValue') || '';
            const t = n.getAttribute('class') || n.getAttribute('type') || '';
            if (!text && !/Image|Button/.test(t)) continue;
            const d = document.createElement('div');
            Object.assign(d.style, { position: 'absolute', left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px', boxSizing: 'border-box',
                display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px',
                background: /Button/.test(t) ? '#3b6fe0' : /Edit|TextField/.test(t) ? '#fff' : /Image/.test(t) ? '#c9d3e6' : 'transparent',
                color: /Button/.test(t) ? '#fff' : '#222', border: /Edit|TextField/.test(t) ? '1px solid #ccd' : '0' });
            d.textContent = text;
            document.body.append(d);
        }
    </script></body>`);
    const png = await p.screenshot();
    await p.close();
    return 'data:image/png;base64,' + png.toString('base64');
}

function page() {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${read('inspector.css')}${read('session.css')}</style></head>
<body>${read('body.html')}
<script>
window.__sent = [];
window.acquireVsCodeApi = () => ({ postMessage(m) { window.__sent.push(m); }, getState() {}, setState() {} });
window.__host = m => window.postMessage(m, '*');
</script>
<script>${read('locators.js')}</script><script>${read('codegen.js')}</script><script>${read('inspector.js')}</script></body></html>`;
}

async function run(browser, platform) {
    const errors = [];
    const p = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await p.setContent(page());
    const host = m => p.evaluate(x => window.__host(x), m);
    const sent = () => p.evaluate(() => window.__sent);
    const settle = () => p.waitForTimeout(250);

    // session setup
    await host(environment);
    await host({ type: 'settings', settings: { javaClient: '11', style: 'pageFactory' } });
    await host({ type: 'profiles', profiles: [] });
    const device = devices.find(d => d.platform === platform);
    await host({ type: 'chooseDevice', id: device.id });
    await settle();
    // the form asks the host for the device's apps and offers them in the field's list
    const listApps = (await sent()).filter(m => m.type === 'listApps').pop();
    assert.strictEqual(listApps && listApps.deviceId, device.id, 'apps requested for the chosen device');
    if (platform === 'android') {
        await host({ type: 'apps', deviceId: device.id, apps: [{ id: 'com.example.shop' }, { id: 'com.starlettech.letsbet.stage' }] });
        await settle();
        assert.deepStrictEqual(await p.$$eval('#installedApps option', o => o.map(x => x.value)), ['com.example.shop', 'com.starlettech.letsbet.stage']);
        assert.match(await p.textContent('#appsNote'), /2 apps installed on Pixel 8 API 35/);
        assert.strictEqual(await p.inputValue('#appPackage'), '', 'two apps: nothing is chosen for the user');
        // a pick from the list that VS Code reports as 'change' only still reaches the form
        await p.evaluate(() => { const f = document.getElementById('appPackage'); f.value = 'com.starlettech.letsbet.stage'; f.dispatchEvent(new Event('change')); });
        await p.waitForTimeout(300);
        assert.strictEqual((await sent()).filter(m => m.type === 'preview').pop().form.app.appPackage, 'com.starlettech.letsbet.stage');
        await p.fill('#appPackage', 'com.example.shop');
        await settle();
        const resolve = (await sent()).filter(m => m.type === 'resolveActivity').pop();
        assert.strictEqual(resolve.package, 'com.example.shop');
        await host({ type: 'activity', deviceId: device.id, package: 'com.example.shop', activity: '.MainActivity' });
        await settle();
        assert.match(await p.getAttribute('#appActivity', 'placeholder'), /^\.MainActivity/);
    } else {
        await host({ type: 'apps', deviceId: device.id, apps: [{ id: 'com.example.shop', name: 'Shop', system: false }, { id: 'com.apple.Preferences', name: 'Settings', system: true }] });
        await settle();
        assert.strictEqual(await p.inputValue('#bundleId'), 'com.example.shop', 'the only app of the user is filled in');
        assert.match(await p.textContent('#appsNote'), /1 app installed on iPhone 17 \(\+1 system\)/);
    }
    await p.waitForTimeout(300);
    const preview = (await sent()).filter(m => m.type === 'preview').pop();
    assert.strictEqual(preview.form.deviceId, device.id);
    assert.deepStrictEqual(preview.form.app, platform === 'android'
        ? { kind: 'installed', appPackage: 'com.example.shop', appActivity: '' } : { kind: 'installed', bundleId: 'com.example.shop' });
    await host({ type: 'preview', capabilities: { platformName: platform === 'android' ? 'Android' : 'iOS', 'appium:udid': device.id, 'appium:noReset': true }, problems: [], warnings: [] });
    await settle();
    await p.screenshot({ path: path.join(out, `inspector-${platform}-setup.png`) });
    await p.click('#startSession');
    assert.strictEqual((await sent()).filter(m => m.type === 'startSession').length, 1, 'start session sent');

    // session and screen
    await host({ type: 'session', device, capabilities: {} });
    const source = fs.readFileSync(path.join(fixtures, `${platform}-source.xml`), 'utf8');
    const win = platform === 'android' ? { x: 0, y: 0, width: 1080, height: 2400 } : { x: 0, y: 0, width: 402, height: 874 };
    const shot = platform === 'android' ? await fakeScreenshot(browser, source, 'android', 360, 800, 3) : await fakeScreenshot(browser, source, 'ios', 402, 874, 3);
    await host({ type: 'screen', screenshot: shot, source, window: win, ms: 420 });
    await p.waitForTimeout(500);
    assert.strictEqual(await p.isHidden('#setup'), true);
    const count = await p.textContent('#treeCount');
    assert.strictEqual(count, platform === 'android' ? '11 elements' : '10 elements');

    // click the sign-in button on the screen
    const img = await p.$('#shot');
    const box = await img.boundingBox();
    const target = platform === 'android' ? { x: 540, y: 786 } : { x: 200, y: 335 };
    await p.mouse.click(box.x + box.width * target.x / win.width, box.y + box.height * target.y / win.height);
    await settle();
    const details = await p.textContent('#details');
    if (platform === 'android') {
        assert.match(details, /com\.example\.shop:id\/sign_in/);
        assert.match(details, /@AndroidFindBy\(id = "com\.example\.shop:id\/sign_in"\)/);
        assert.match(details, /private WebElement signInButton;/);
    } else {
        assert.match(details, /loginButton/);
        assert.match(details, /@iOSXCUITFindBy\(accessibility = "loginButton"\)/);
        assert.match(details, /label == 'Sign in'/);
    }
    assert.ok(await p.isVisible('#selectBox'), 'selection drawn on the screen');
    await p.screenshot({ path: path.join(out, `inspector-${platform}-selected.png`) });

    // verify the first locator on the device
    await p.click('#details [data-verify="0"]');
    const verify = (await sent()).filter(m => m.type === 'verify').pop();
    assert.ok(verify && verify.locator.value, 'verify sent');
    await host({ type: 'verified', key: verify.key, count: 1 });
    await settle();
    assert.match(await p.textContent('#details'), /device: unique/);

    // finder: XPath counted in the webview DOM
    await p.selectOption('#strategy', 'xpath');
    await p.fill('#search', platform === 'android' ? "//android.widget.TextView[@resource-id='com.example.shop:id/add']" : "//XCUIElementTypeButton");
    await p.waitForTimeout(400);
    assert.match(await p.textContent('#findCount'), platform === 'android' ? /of 2/ : /of 3/);

    // record: tap the button in Record mode, then back (android) / home
    await p.click('#mode [data-mode="record"]');
    await p.mouse.click(box.x + box.width * target.x / win.width, box.y + box.height * target.y / win.height);
    await p.click(platform === 'android' ? '[data-button="back"]' : '[data-button="home"]');
    await p.click('.tab[data-tab="recorded"]');
    await settle();
    const recorded = await p.textContent('#recorded');
    assert.match(recorded, /import io\.appium\.java_client\.support\.PageFactory;/);
    assert.match(recorded, platform === 'android' ? /signInButton\.click\(\);[\s\S]*driver\.navigate\(\)\.back\(\);/ : /loginButton\.click\(\);[\s\S]*mobile: pressButton/);
    const taps = (await sent()).filter(m => m.type === 'tap');
    assert.ok(taps.length >= 1, 'record mode taps the device');
    await p.screenshot({ path: path.join(out, `inspector-${platform}-recorded.png`) });

    // page source tab
    await p.click('.tab[data-tab="source"]');
    await settle();
    assert.match(await p.textContent('#source'), platform === 'android' ? /<hierarchy/ : /<AppiumAUT>/);

    // the session ends from the host side
    await host({ type: 'sessionEnded', message: 'The session ended (timeout or crash). Start a new session.' });
    await settle();
    assert.strictEqual(await p.isHidden('#panes'), true);
    assert.deepStrictEqual(errors, [], 'no script errors');
    await p.close();
    console.log(`${platform}: ok`);
}

(async () => {
    const browser = await chromium.launch();
    try {
        await run(browser, 'android');
        await run(browser, 'ios');
    } finally {
        await browser.close();
    }
    console.log('screenshots in ' + out);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
