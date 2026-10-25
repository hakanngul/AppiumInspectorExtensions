// TestFly - Appium Inspector webview. Talks to the extension host with postMessage; the host talks to Appium.
// The page source is parsed here once (DOMParser): the tree, hit testing, XPath counts and locators all use that DOM.
(function () {
    'use strict';
    const vscode = acquireVsCodeApi();
    const L = window.AppiumLocators;
    const C = window.AppiumCodegen;
    const $ = id => document.getElementById(id);

    const ICON = {
        copy: '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5H5"/></svg>',
        java: '<svg viewBox="0 0 16 16"><path d="M5.5 4L2 8l3.5 4"/><path d="M10.5 4L14 8l-3.5 4"/></svg>',
        chev: '<svg viewBox="0 0 16 16" class="chev"><path d="M6 4l4 4-4 4"/></svg>',
        tap: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><circle cx="8" cy="8" r="5.5"/></svg>',
        hold: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>',
        type: '<svg viewBox="0 0 16 16"><path d="M3 4h10M8 4v9"/></svg>',
        device: '<svg viewBox="0 0 16 16"><rect x="4.5" y="1.5" width="7" height="13" rx="1.8"/><path d="M7 12h2"/></svg>',
    };
    const STRATEGIES = [
        { using: 'id', label: 'id', placeholder: { android: 'com.app:id/login or login', ios: 'accessibility id (name)' } },
        { using: 'accessibility id', label: 'accessibility id', placeholder: { android: 'content-desc, e.g. Login', ios: 'name, e.g. loginButton' } },
        { using: 'xpath', label: 'XPath', placeholder: { android: "//android.widget.Button[@text='Go']", ios: "//XCUIElementTypeButton[@name='Go']" } },
        { using: 'class name', label: 'class name', placeholder: { android: 'android.widget.EditText', ios: 'XCUIElementTypeButton' } },
        { using: '-android uiautomator', label: 'UiAutomator', platform: 'android', placeholder: { android: 'new UiSelector().text("Sign in")' } },
        { using: '-ios predicate string', label: 'predicate', platform: 'ios', placeholder: { ios: "label == 'Sign in'" } },
        { using: '-ios class chain', label: 'class chain', platform: 'ios', placeholder: { ios: "**/XCUIElementTypeButton[`label == 'Sign in'`]" } },
    ];
    const INDENT = 16;

    const saved = vscode.getState() || {};
    const state = {
        env: { server: { state: 'stopped', url: '', version: '' }, devices: [], devicesLoading: false, busy: false, platform: '' },
        settings: { javaClient: '11', style: 'pageFactory' },
        profiles: [],
        form: saved.form || { deviceId: '', app: { kind: 'installed' }, extra: '' },
        session: null, platform: 'android',
        doc: null, rootEl: null, nodes: [], paths: new Map(), byKey: new Map(), source: '',
        screen: null, window: null, selected: null, hovered: null, expanded: new Set(saved.expanded || []),
        mode: saved.mode || 'inspect', tab: 'tree', verified: new Map(),
        steps: [], fields: [], used: new Set(),
        apps: { deviceId: '', list: [], loading: false, error: '' },
        find: { using: saved.findUsing || 'xpath', query: '', matches: [], set: new Set(), current: -1, error: '', unknown: false },
    };

    // ── host messages ───────────────────────────────────────────────────
    window.addEventListener('message', e => {
        if (e.origin !== window.location.origin || !e.data || typeof e.data !== 'object') return;
        const m = e.data;
        switch (m.type) {
            case 'environment': return onEnvironment(m);
            case 'settings': state.settings = m.settings; return state.session && (renderDetails(), renderRecorded());
            case 'profiles': return onProfiles(m.profiles, m.selected);
            case 'chooseDevice': state.form.deviceId = m.id; return renderSetup(true);
            case 'preview': return onPreview(m);
            case 'apps': return onApps(m);
            case 'activity': return onActivity(m);
            case 'appPicked': $('appPath').value = m.path; readForm(); return requestPreview();
            case 'session': return onSession(m);
            case 'sessionEnded': return onSessionEnded(m.message);
            case 'shot': $('shot').src = imageSrc(m.screenshot); $('deviceFrame').hidden = false; $('emptyScreen').hidden = true; return;
            case 'screen': return onScreen(m);
            case 'status': return setStatus(m.state, m.message);
            case 'error': return onError(m.message);
            case 'verified': state.verified.set(m.key, m.count); return renderDetails();
            case 'found': return onFound(m.rects);
            case 'swiped': return recordStep({ action: 'swipe', from: m.from, to: m.to });
        }
    });

    function send(message) {
        vscode.postMessage(message);
    }

    function persist() {
        vscode.setState({ mode: state.mode, expanded: [...state.expanded], cols: saved.cols, findUsing: state.find.using, form: state.form });
    }

    // ── status & toasts ─────────────────────────────────────────────────
    function setStatus(kind, text) {
        $('status').dataset.state = kind;
        $('statusText').textContent = text;
        $('loadingBar').hidden = kind !== 'loading';
        $('stage').classList.toggle('stale', kind === 'loading');
        if (!state.doc && kind !== 'ok') $('emptyHint').textContent = text;
    }

    let toastTimer;
    function toast(text, error) {
        const t = $('toast');
        t.textContent = text;
        t.classList.toggle('error', !!error);
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), error ? 6000 : 1800);
    }

    function onError(message) {
        setStatus('error', 'Error');
        toast(message, true);
        $('startSession').disabled = false;
    }

    function copy(text, label) {
        send({ type: 'copy', text, label });
        toast('Copied ' + label);
    }

    // ── environment: server and devices ─────────────────────────────────
    function onEnvironment(m) {
        state.env = m;
        const b = $('server');
        const s = m.server.state;
        b.dataset.state = s;
        b.classList.toggle('busy', m.busy);
        $('serverText').textContent = s === 'running' || s === 'external' ? `Appium ${m.server.version || ''}`.trim()
            : s === 'starting' ? 'Starting…' : s === 'stopping' ? 'Stopping…' : 'Appium stopped';
        b.title = s === 'running' ? `Appium at ${m.server.url}. Click to stop it.`
            : s === 'external' ? `Appium at ${m.server.url}, started outside VS Code.`
                : `Appium is not running at ${m.server.url}. Click to start it.`;
        b.disabled = s === 'external' || m.busy;
        renderSetup(false);
    }

    $('server').addEventListener('click', () => {
        const s = state.env.server.state;
        if (s === 'running') send({ type: 'server', action: 'stop' });
        else if (s === 'stopped') send({ type: 'server', action: 'start' });
    });

    // ── session setup ───────────────────────────────────────────────────
    function currentDevice() {
        return state.env.devices.find(d => d.id === state.form.deviceId);
    }

    function deviceLabel(d) {
        const os = d.platform === 'ios' ? 'iOS' : 'Android';
        const kind = d.kind === 'emulator' ? 'emulator' : d.kind === 'simulator' ? 'simulator' : 'device';
        const st = d.state === 'ready' ? '' : ` — ${d.state}`;
        return `${d.name}  ·  ${os}${d.version ? ' ' + d.version : ''}  ·  ${kind}${st}`;
    }

    let lastDevices = '';
    function renderSetup(force) {
        const sel = $('deviceSel');
        const list = state.env.devices;
        const key = JSON.stringify(list.map(d => [d.id, d.state])) + state.form.deviceId;
        if (force || key !== lastDevices) {
            lastDevices = key;
            sel.innerHTML = '';
            if (!list.length) sel.append(new Option(state.env.devicesLoading ? 'Looking for devices…' : 'No device found', ''));
            const usable = list.filter(d => d.state === 'ready');
            if (list.length && (!state.form.deviceId || !list.some(d => d.id === state.form.deviceId))) {
                state.form.deviceId = usable.length ? usable[0].id : list.length ? list[0].id : '';
            }
            for (const d of list) {
                const o = new Option(deviceLabel(d), d.id);
                o.disabled = !['ready', 'shutdown', 'booting'].includes(d.state);
                sel.append(o);
            }
            sel.value = state.form.deviceId;
        }
        const d = currentDevice();
        const platform = d ? d.platform : 'android';
        document.body.classList.toggle('platform-android', platform === 'android');
        document.body.classList.toggle('platform-ios', platform === 'ios');
        $('bootDevice').hidden = !(d && d.state === 'shutdown');
        $('deviceNote').textContent = !d ? 'Start an emulator or simulator, or connect a device, then reload.'
            : d.reason || (d.state === 'shutdown' ? 'This simulator is shut down: boot it first.' : `appium:udid ${d.id}`);
        $('appFileHint').textContent = platform === 'android' ? '.apk' : d && d.kind === 'real' ? '.ipa or device .app' : 'simulator .app or .zip';
        $('reloadDevices').textContent = state.env.devicesLoading ? 'Loading…' : 'Reload';
        if (force) writeForm();
        requestApps(false);
        requestPreview();
    }

    // ── installed apps (pm list packages / simctl listapps / devicectl) ──
    function requestApps(force) {
        const d = currentDevice();
        const a = state.apps;
        if (!d || d.state !== 'ready') {
            if (a.deviceId !== (d ? d.id : '')) {
                state.apps = { deviceId: d ? d.id : '', list: [], loading: false, error: d ? 'Boot the device to list its apps.' : '' };
                renderApps();
            }
            return;
        }
        if (!force && a.deviceId === d.id && (a.loading || a.list.length || a.error)) return;
        state.apps = { deviceId: d.id, list: [], loading: true, error: '' };
        renderApps();
        send({ type: 'listApps', deviceId: d.id, force: !!force });
    }

    function onApps(m) {
        if (m.deviceId !== state.form.deviceId) return;
        state.apps = { deviceId: m.deviceId, list: m.apps || [], loading: false, error: m.error || '' };
        // One app of the user's own on the device: that is the one to inspect.
        const own = state.apps.list.filter(a => !a.system);
        const d = currentDevice();
        const field = d && d.platform === 'ios' ? $('bundleId') : $('appPackage');
        if (own.length === 1 && !field.value.trim()) {
            field.value = own[0].id;
            readForm();
            requestPreview();
        }
        renderApps();
        resolveActivity();
    }

    function renderApps() {
        const a = state.apps;
        const list = $('installedApps');
        list.innerHTML = '';
        for (const app of a.list) {
            const o = document.createElement('option');
            o.value = app.id;
            o.label = [app.name, app.system ? 'system' : ''].filter(Boolean).join(' · ');
            list.append(o);
        }
        const d = currentDevice();
        const own = a.list.filter(x => !x.system).length;
        $('appsNote').textContent = a.loading ? 'Reading the apps on the device…'
            : a.error ? a.error
                : a.list.length ? `${own} app${own === 1 ? '' : 's'} installed on ${d ? d.name : 'the device'}${a.list.length > own ? ` (+${a.list.length - own} system)` : ''}: pick one from the field's list or type it.`
                    : d && d.state === 'ready' ? 'No installed apps found; type the id.' : '';
        $('appsNote').classList.toggle('error-note', !!a.error);
        document.querySelectorAll('.apps-reload').forEach(b => { b.disabled = a.loading || !d || d.state !== 'ready'; });
    }

    let lastResolved = '';
    /** Android: shows the package's launcher activity as the hint of the activity field; Appium finds it the same way. */
    function resolveActivity() {
        const d = currentDevice();
        const pkg = $('appPackage').value.trim();
        if (!d || d.platform !== 'android' || !state.apps.list.some(a => a.id === pkg)) {
            $('appActivity').placeholder = '.MainActivity';
            lastResolved = '';
            return;
        }
        if (lastResolved === d.id + '/' + pkg) return;
        lastResolved = d.id + '/' + pkg;
        send({ type: 'resolveActivity', deviceId: d.id, package: pkg });
    }

    function onActivity(m) {
        if (m.deviceId !== state.form.deviceId || m.package !== $('appPackage').value.trim()) return;
        $('appActivity').placeholder = m.activity ? `${m.activity}  (auto)` : 'No launcher activity found';
        $('appActivity').title = m.activity ? 'Launcher activity found on the device; Appium starts it when this field is empty.' : '';
    }

    function writeForm() {
        const f = state.form;
        document.querySelectorAll('#appKind button').forEach(b => b.classList.toggle('active', b.dataset.kind === f.app.kind));
        $('fieldsInstalled').hidden = f.app.kind !== 'installed';
        $('fieldsFile').hidden = f.app.kind !== 'file';
        $('fieldsNone').hidden = f.app.kind !== 'none';
        $('appPackage').value = f.app.appPackage || '';
        $('appActivity').value = f.app.appActivity || '';
        $('bundleId').value = f.app.bundleId || '';
        $('appPath').value = f.app.path || '';
        $('extra').value = f.extra || '';
        if (f.extra) $('advanced').open = true;
    }

    /** All app fields are kept, whatever the kind, so switching kinds does not lose what was typed. */
    function readForm() {
        const kind = (document.querySelector('#appKind button.active') || {}).dataset.kind || 'installed';
        const app = { kind, appPackage: $('appPackage').value.trim(), appActivity: $('appActivity').value.trim(), bundleId: $('bundleId').value.trim(), path: $('appPath').value.trim() };
        state.form = { deviceId: $('deviceSel').value || state.form.deviceId, app, extra: $('extra').value };
        persist();
        return state.form;
    }

    /** The form as the host expects it: only the fields of the chosen app kind and platform. */
    function formForDevice() {
        const f = state.form, d = currentDevice();
        const a = f.app;
        const app = a.kind === 'file' ? { kind: 'file', path: a.path || '' }
            : a.kind === 'none' ? { kind: 'none' }
                : d && d.platform === 'ios' ? { kind: 'installed', bundleId: a.bundleId || '' }
                    : { kind: 'installed', appPackage: a.appPackage || '', appActivity: a.appActivity || '' };
        return { deviceId: f.deviceId, app, extra: f.extra };
    }

    let previewTimer;
    function requestPreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => send({ type: 'preview', form: formForDevice() }), 120);
    }

    function onPreview(m) {
        $('capsPreview').innerHTML = m.capabilities ? jsonHl(JSON.stringify(m.capabilities, null, 2)) : '<span class="muted">Choose a device.</span>';
        const box = $('problems');
        box.innerHTML = '';
        for (const p of m.problems || []) box.append(li(p, ''));
        for (const w of m.warnings || []) box.append(li(w, 'warn'));
        box.hidden = !box.children.length;
        $('startSession').disabled = !!(m.problems && m.problems.length) || state.env.busy;
    }

    function li(text, cls) {
        const n = document.createElement('li');
        n.className = cls;
        n.textContent = text;
        return n;
    }

    function onProfiles(profiles, selected) {
        state.profiles = profiles || [];
        const sel = $('profileSel');
        sel.innerHTML = '';
        sel.append(new Option(state.profiles.length ? 'Saved profiles…' : 'No saved profiles', ''));
        for (const p of state.profiles) sel.append(new Option(p.name, p.name));
        sel.value = selected || '';
        $('deleteProfile').disabled = !sel.value;
    }

    $('profileSel').addEventListener('change', e => {
        const p = state.profiles.find(x => x.name === e.target.value);
        $('deleteProfile').disabled = !p;
        if (!p) return;
        state.form = { deviceId: state.env.devices.some(d => d.id === p.deviceId) ? p.deviceId : state.form.deviceId, app: p.app, extra: p.extra || '' };
        renderSetup(true);
    });
    $('saveProfile').addEventListener('click', () => send({ type: 'saveProfile', form: readForm() }));
    $('deleteProfile').addEventListener('click', () => $('profileSel').value && send({ type: 'deleteProfile', name: $('profileSel').value }));
    $('deviceSel').addEventListener('change', () => { readForm(); renderSetup(false); });
    $('reloadDevices').addEventListener('click', () => send({ type: 'reloadDevices' }));
    $('bootDevice').addEventListener('click', () => send({ type: 'boot', id: state.form.deviceId }));
    document.querySelectorAll('#appKind button').forEach(b => b.addEventListener('click', () => {
        readForm();
        state.form.app.kind = b.dataset.kind;
        writeForm();
        readForm();
        requestPreview();
    }));
    // A pick from the field's app list may arrive as 'change' only (VS Code webviews), so both events update the form.
    ['appPackage', 'appActivity', 'bundleId', 'appPath', 'extra'].forEach(id => ['input', 'change'].forEach(ev =>
        $(id).addEventListener(ev, () => { readForm(); requestPreview(); })));
    $('appPackage').addEventListener('change', resolveActivity);
    $('appPackage').addEventListener('input', resolveActivity);
    document.querySelectorAll('.apps-reload').forEach(b => b.addEventListener('click', () => requestApps(true)));
    $('browseApp').addEventListener('click', () => {
        const d = currentDevice();
        send({ type: 'pickApp', platform: d ? d.platform : 'android', kind: d ? d.kind : 'emulator' });
    });
    $('copyCaps').addEventListener('click', () => copy($('capsPreview').textContent, 'capabilities'));
    $('setupForm').addEventListener('submit', e => {
        e.preventDefault();
        readForm();
        $('startSession').disabled = true;
        send({ type: 'startSession', form: formForDevice() });
    });

    // ── session lifecycle ───────────────────────────────────────────────
    function onSession(m) {
        state.session = m;
        state.platform = m.device.platform;
        state.doc = null;
        state.selected = null;
        state.verified = new Map();
        $('setup').hidden = true;
        $('panes').hidden = false;
        $('sessionChip').hidden = false;
        $('sessionTools').hidden = false;
        $('endSession').hidden = false;
        $('platform').dataset.platform = state.platform;
        $('platform').textContent = state.platform === 'ios' ? 'iOS' : 'Android';
        $('sessionDevice').textContent = m.device.name;
        $('backButton').disabled = state.platform === 'ios';
        $('deviceFrame').hidden = true;
        $('emptyScreen').hidden = false;
        $('startSession').disabled = false;
        renderStrategies();
        renderDetails();
        renderRecorded();
    }

    function onSessionEnded(message) {
        state.session = null;
        state.doc = null;
        state.nodes = [];
        $('setup').hidden = false;
        $('panes').hidden = true;
        $('sessionChip').hidden = true;
        $('sessionTools').hidden = true;
        $('endSession').hidden = true;
        $('startSession').disabled = false;
        setStatus('idle', 'No session');
        if (message) toast(message, true);
        renderSetup(true);
    }

    $('endSession').addEventListener('click', () => send({ type: 'endSession' }));

    // ── screen ──────────────────────────────────────────────────────────
    function onScreen(m) {
        const previous = state.selected ? L.absoluteXpath(state.selected) : null;
        const doc = new DOMParser().parseFromString(m.source, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) {
            state.source = m.source;
            renderSource();
            return onError('The page source is not valid XML; see the Page Source tab.');
        }
        state.doc = doc;
        state.rootEl = doc.documentElement;
        state.platform = L.platformOf(state.rootEl);
        state.nodes = L.flatten(state.rootEl);
        state.source = m.source;
        state.window = m.window;
        state.verified = new Map();
        indexPaths();
        state.hovered = null;
        state.selected = previous ? evalXpath(previous)[0] || null : null;

        const img = $('shot');
        img.onload = () => {
            // Android bounds are screen pixels, like the screenshot; iOS uses points, like window/rect.
            state.screen = state.platform === 'android' ? { width: img.naturalWidth, height: img.naturalHeight } : { width: m.window.width, height: m.window.height };
            $('screen').style.setProperty('--ratio', `${img.naturalWidth} / ${img.naturalHeight}`);
            $('screenMeta').textContent = `${state.screen.width}×${state.screen.height}${state.platform === 'ios' ? ' pt' : ' px'}`;
            renderBounds();
            renderSelection();
        };
        img.src = imageSrc(m.screenshot);
        $('deviceFrame').hidden = false;
        $('emptyScreen').hidden = true;
        $('treeCount').textContent = `${state.nodes.length} elements`;
        setStatus('ok', `${state.session ? state.session.device.name + ' · ' : ''}${state.nodes.length} elements · ${m.ms} ms`);
        if (state.find.query) runFind(true);
        renderTree();
        renderDetails();
        renderSource();
    }

    function indexPaths() {
        state.paths = new Map();
        state.byKey = new Map();
        const walk = (n, prefix) => L.kids(n).forEach((c, i) => {
            const key = prefix ? prefix + '/' + i : String(i);
            state.paths.set(c, key);
            state.byKey.set(key, c);
            walk(c, key);
        });
        walk(state.rootEl, '');
    }

    function evalXpath(expr) {
        if (!state.doc) return [];
        const res = state.doc.evaluate(expr, state.doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out = [];
        for (let i = 0; i < res.snapshotLength; i++) {
            let n = res.snapshotItem(i);
            if (n.nodeType === 2) n = n.ownerElement;
            else if (n.nodeType !== 1) n = n.parentNode;
            if (n && n !== state.rootEl && state.paths.has(n) && !out.includes(n)) out.push(n);
        }
        return out;
    }

    function ctx() {
        return { platform: state.platform, nodes: state.nodes, evalXpath };
    }

    function rect(n) {
        return L.rectOf(n, state.platform);
    }

    function pct(v, total) {
        return (100 * v / (total || 1)) + '%';
    }

    function place(box, r) {
        const s = state.screen || { width: 1, height: 1 };
        box.style.left = pct(r.x, s.width);
        box.style.top = pct(r.y, s.height);
        box.style.width = pct(r.width, s.width);
        box.style.height = pct(r.height, s.height);
    }

    function renderBounds() {
        const overlay = $('overlay');
        overlay.innerHTML = '';
        if (!$('showBounds').checked || !state.screen) return;
        const frag = document.createDocumentFragment();
        for (const n of state.nodes) {
            const r = rect(n);
            if (!r || !r.width || !L.isVisible(n, state.platform)) continue;
            const b = document.createElement('div');
            b.className = 'b';
            place(b, r);
            frag.append(b);
        }
        overlay.append(frag);
    }

    function renderHover() {
        const box = $('hoverBox');
        const n = state.hovered;
        document.querySelectorAll('.row.hovered').forEach(r => r.classList.remove('hovered'));
        const r = n && rect(n);
        if (!n || !r || !state.screen || n === state.selected) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        place(box, r);
        box.classList.toggle('below', r.y < state.screen.height * 0.06);
        box.classList.toggle('right', r.x + r.width > state.screen.width * 0.7);
        const id = idText(n);
        box.innerHTML = `<span class="tag">${esc(L.shortType(L.typeOf(n, state.platform)))}${id ? ' #' + esc(id) : ''}</span>`;
        const row = rowFor(n);
        if (row) row.classList.add('hovered');
    }

    function renderSelection() {
        const box = $('selectBox');
        const n = state.selected;
        const r = n && rect(n);
        if (!r || !state.screen) {
            box.hidden = true;
        } else {
            box.hidden = false;
            place(box, r);
        }
        $('selIndex').hidden = !n;
        $('selIndex').textContent = n ? L.shortType(L.typeOf(n, state.platform)) : '';
    }

    function toDevice(event) {
        const r = $('shot').getBoundingClientRect();
        const s = state.screen;
        return { x: (event.clientX - r.left) / r.width * s.width, y: (event.clientY - r.top) / r.height * s.height };
    }

    function center(n) {
        const r = rect(n) || { x: 0, y: 0, width: 0, height: 0 };
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }

    const screenEl = $('screen');
    screenEl.addEventListener('mousemove', e => {
        if (!state.screen) return;
        const p = toDevice(e);
        const hit = state.mode !== 'tap' ? L.hitTest(state.nodes, state.platform, p.x, p.y) : null;
        if (hit !== state.hovered) {
            state.hovered = hit;
            renderHover();
        }
    });
    screenEl.addEventListener('mouseleave', () => {
        state.hovered = null;
        renderHover();
    });
    screenEl.addEventListener('click', e => {
        if (!state.screen) return;
        const p = toDevice(e);
        if (state.mode === 'inspect') return select(L.hitTest(state.nodes, state.platform, p.x, p.y), true);
        ripple(e);
        if (state.mode === 'record') {
            const hit = L.hitTest(state.nodes, state.platform, p.x, p.y);
            recordElement(hit, 'click', null, p);
            const c = hit ? center(hit) : p;
            send({ type: 'tap', x: c.x, y: c.y });
        } else {
            send({ type: 'tap', x: p.x, y: p.y });
        }
    });

    function ripple(e) {
        const r = $('ripple');
        const rc = screenEl.getBoundingClientRect();
        r.hidden = false;
        r.style.left = (e.clientX - rc.left) + 'px';
        r.style.top = (e.clientY - rc.top) + 'px';
        r.style.animation = 'none';
        void r.offsetWidth;
        r.style.animation = '';
    }

    function select(n, reveal) {
        state.selected = n;
        state.hovered = null;
        if (n && reveal) {
            const parts = (state.paths.get(n) || '').split('/');
            for (let i = 1; i < parts.length; i++) state.expanded.add(parts.slice(0, i).join('/'));
            persist();
        }
        renderTree();
        renderHover();
        renderSelection();
        renderDetails();
        if (n && reveal) {
            const row = rowFor(n);
            if (row) row.scrollIntoView({ block: 'nearest' });
        }
    }

    // ── tree ────────────────────────────────────────────────────────────
    /** A badge per element kind: interactive kinds get their own colour, containers show as layout or list. */
    function kindOf(n) {
        const t = L.shortType(L.typeOf(n, state.platform));
        if (/edittext|textfield|searchfield|autocomplete/i.test(t)) return { role: 'textfield', label: 'T' };
        if (/^(textview|statictext|text)$/i.test(t)) return { role: 'text', label: 'A' };
        if (/button/i.test(t)) return { role: 'button', label: 'B' };
        if (/switch|checkbox|toggle|radiobutton/i.test(t)) return { role: 'switch', label: 'S' };
        if (/image/i.test(t)) return { role: 'image', label: 'I' };
        if (/recyclerview|listview|gridview|scrollview|viewpager|table|collectionview/i.test(t)) return { role: 'list', label: 'L' };
        if (/layout|viewgroup|^group$|window|toolbar|navigationbar|tabbar|cardview|^other$|application/i.test(t)) return { role: 'layout', label: (t.charAt(0) || '?').toUpperCase() };
        return { role: 'other', label: (t.charAt(0) || '?').toUpperCase() };
    }

    function idText(n) {
        if (state.platform === 'android') return L.attr(n, 'resource-id').replace(/^.*:id\//, '');
        return L.attr(n, 'name');
    }

    function rowFor(n) {
        const key = state.paths.get(n);
        return key == null ? null : $('tree').querySelector(`.row[data-key="${key}"]`);
    }

    function renderTree() {
        const tree = $('tree');
        const frag = document.createDocumentFragment();
        const walk = (n, depth) => {
            for (const c of L.kids(n)) {
                const key = state.paths.get(c);
                const children = L.kids(c);
                const open = state.expanded.has(key) || depth < 2;
                frag.append(row(c, key, depth, children.length > 0, open));
                if (children.length && open) walk(c, depth + 1);
            }
        };
        if (state.rootEl) walk(state.rootEl, 0);
        tree.innerHTML = '';
        if (!frag.childNodes.length) {
            tree.innerHTML = '<div class="empty-state small"><p>The tree appears after the first refresh.</p></div>';
            return;
        }
        tree.append(frag);
    }

    function row(n, key, depth, hasKids, open) {
        const r = document.createElement('div');
        const f = state.find;
        r.className = 'row' + (n === state.selected ? ' selected' : '') + (f.set.has(n) ? ' match' + (f.matches[f.current] === n ? ' current' : '') : '')
            + (L.isVisible(n, state.platform) ? '' : ' dim');
        r.dataset.key = key;
        r.setAttribute('role', 'treeitem');
        if (hasKids) r.setAttribute('aria-expanded', String(open));
        const k = kindOf(n);
        const text = L.titleOf(n, state.platform);
        const id = idText(n);
        r.innerHTML = '<span class="indent"></span>' +
            ICON.chev.replace('class="chev"', `class="chev${hasKids ? (open ? ' open' : '') : ' none'}"`) +
            `<span class="kind ${k.role}">${esc(k.label)}</span>` +
            `<span class="type">${esc(L.shortType(L.typeOf(n, state.platform)))}</span>` +
            (text && text !== id ? `<span class="txt">“<b>${esc(text)}</b>”</span>` : '') +
            (id ? `<span class="id">#${esc(id)}</span>` : '');
        r.querySelector('.indent').style.width = `${depth * INDENT + 4}px`;
        r.addEventListener('click', ev => {
            if (hasKids && ev.target.closest('.chev')) return toggle(key, !open);
            select(n, false);
        });
        r.addEventListener('dblclick', () => hasKids && toggle(key, !open));
        r.addEventListener('mouseenter', () => { state.hovered = n; renderHover(); });
        r.addEventListener('mouseleave', () => { state.hovered = null; renderHover(); });
        return r;
    }

    function toggle(key, open) {
        if (open) state.expanded.add(key); else state.expanded.delete(key);
        persist();
        renderTree();
    }

    $('tree').addEventListener('keydown', e => {
        const rows = [...$('tree').querySelectorAll('.row')];
        if (!rows.length) return;
        const current = state.selected ? rows.findIndex(r => r.classList.contains('selected')) : -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = rows[Math.max(0, Math.min(rows.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)))];
            select(state.byKey.get(next.dataset.key), false);
            next.scrollIntoView({ block: 'nearest' });
        } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && state.selected) {
            e.preventDefault();
            toggle(state.paths.get(state.selected), e.key === 'ArrowRight');
        }
    });

    // ── finder (Appium Inspector's "Search for element") ────────────────
    function renderStrategies() {
        const sel = $('strategy');
        sel.innerHTML = '';
        for (const s of STRATEGIES.filter(s => !s.platform || s.platform === state.platform)) sel.append(new Option(s.label, s.using));
        if (![...sel.options].some(o => o.value === state.find.using)) state.find.using = 'xpath';
        sel.value = state.find.using;
        updatePlaceholder();
    }

    function updatePlaceholder() {
        const s = STRATEGIES.find(x => x.using === state.find.using);
        $('search').placeholder = (s && s.placeholder[state.platform] || 'Locator') + '  ( / )';
    }

    function runFind(keep) {
        const f = state.find;
        clearFindLayer();
        let res = { matches: [] };
        if (f.query && state.doc) res = L.findLocal(f.using, f.query, ctx());
        f.error = res.error || '';
        f.unknown = !!res.unknown;
        f.matches = res.matches || [];
        f.set = new Set(f.matches);
        f.current = keep && state.selected ? f.matches.indexOf(state.selected) : -1;
        if (!keep && f.matches.length) return step(1);
        renderTree();
        renderFindCount();
    }

    function step(dir) {
        const f = state.find;
        if (!f.matches.length) return renderFindCount();
        f.current = (f.current + dir + f.matches.length) % f.matches.length;
        renderFindCount();
        select(f.matches[f.current], true);
    }

    function renderFindCount() {
        const f = state.find;
        const el = $('findCount');
        el.textContent = !f.query ? '' : f.error ? f.error : f.unknown ? 'Search on device →'
            : f.matches.length ? `${f.current >= 0 ? f.current + 1 : '–'} of ${f.matches.length}` : 'No match';
        el.classList.toggle('none', !!f.query && (!!f.error || (!f.unknown && !f.matches.length)));
        $('findPrev').disabled = $('findNext').disabled = f.matches.length < 2;
        $('findCopy').disabled = !f.query || !!f.error;
        $('findServer').disabled = !f.query || !!f.error || !state.session;
    }

    function onFound(rects) {
        const f = state.find;
        const same = (a, b) => b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
        // Android element rects are in pixels like the bounds; iOS rects in points like x/y/width/height.
        f.matches = state.nodes.filter(n => rects.some(r => same(r, rect(n))));
        f.set = new Set(f.matches);
        f.unknown = false;
        f.current = -1;
        const layer = $('findLayer');
        layer.innerHTML = '';
        for (const r of rects) {
            const b = document.createElement('div');
            b.className = 'f';
            place(b, r);
            layer.append(b);
        }
        $('findCount').textContent = `${rects.length} on device`;
        if (f.matches.length) step(1); else renderTree();
    }

    function clearFindLayer() {
        $('findLayer').innerHTML = '';
    }

    let findTimer;
    $('search').addEventListener('input', e => {
        clearTimeout(findTimer);
        state.find.query = e.target.value.trim();
        findTimer = setTimeout(() => runFind(false), 150);
    });
    $('search').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(findTimer);
            if (state.find.query !== e.target.value.trim()) {
                state.find.query = e.target.value.trim();
                return runFind(false);
            }
            if (state.find.unknown) return findOnDevice();
            step(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape' && e.target.value) {
            e.stopPropagation();
            e.target.value = '';
            state.find.query = '';
            runFind(false);
        }
    });
    $('strategy').addEventListener('change', e => {
        state.find.using = e.target.value;
        updatePlaceholder();
        persist();
        runFind(false);
    });
    function findOnDevice() {
        if (state.find.query) send({ type: 'find', locator: { using: state.find.using, value: state.find.query } });
    }
    $('findServer').addEventListener('click', findOnDevice);
    $('findNext').addEventListener('click', () => step(1));
    $('findPrev').addEventListener('click', () => step(-1));
    $('findCopy').addEventListener('click', () => {
        const loc = { using: state.find.using, value: state.find.query };
        copy(javaFor(loc, C.fieldName({ words: '', type: 'element' }, new Set())), 'Java locator');
    });
    renderFindCount();

    // ── recording ───────────────────────────────────────────────────────
    function bestLocator(n) {
        const list = L.suggest(n, ctx());
        return list.find(s => s.count === 1) || null;
    }

    /** The field for a node in the recorded class; one field per locator. */
    function fieldFor(n, loc) {
        const existing = state.fields.find(f => f.loc.using === loc.using && f.loc.value === loc.value);
        if (existing) return existing.name;
        const name = C.fieldName(L.nameSeed(n, state.platform), state.used);
        state.fields.push({ name, loc: { using: loc.using, value: loc.value } });
        return name;
    }

    function recordElement(n, action, text, point) {
        if (state.mode !== 'record') return;
        const loc = n && bestLocator(n);
        if (loc) {
            recordStep({ action, field: fieldFor(n, loc), text });
        } else if (action === 'click') {
            const p = n ? center(n) : point;
            recordStep({ action: 'tapAt', x: p.x, y: p.y });
        } else {
            toast('This element has no unique locator; the step was not recorded', true);
        }
    }

    function recordStep(step) {
        if (state.mode !== 'record') return;
        state.steps.push(step);
        renderRecorded();
    }

    function recordedCode() {
        return C.pageClass(state.fields, state.steps, {
            platform: state.platform, javaClient: state.settings.javaClient, style: state.settings.style, className: 'RecordedPage', screen: state.screen,
        });
    }

    function renderRecorded() {
        const n = state.steps.length;
        $('recordedCount').hidden = !n;
        $('recordedCount').textContent = n;
        $('recorded').innerHTML = n ? javaHl(recordedCode())
            : '<span class="r">Switch to Record and use the device: taps, typing, swipes, back and home appear here as a java-client page class.</span>';
    }
    $('copyRecorded').addEventListener('click', () => state.steps.length && copy(recordedCode(), 'recorded page class'));
    $('openRecorded').addEventListener('click', () => state.steps.length && send({ type: 'openJava', code: recordedCode() }));
    $('clearRecorded').addEventListener('click', () => { state.steps = []; state.fields = []; state.used = new Set(); renderRecorded(); });

    // ── page source tab ─────────────────────────────────────────────────
    function renderSource() {
        const pre = $('source');
        pre.classList.add('xml');
        if (state.tab !== 'source') return;
        const text = state.source.length > 400000 ? state.source.slice(0, 400000) + '\n…' : state.source;
        pre.innerHTML = esc(text)
            .replace(/(&lt;\/?)([\w.$-]+)/g, '$1<span class="t">$2</span>')
            .replace(/([\w:.-]+)=(&quot;.*?&quot;)/g, '<span class="a">$1</span>=<span class="v">$2</span>');
    }
    $('copySource').addEventListener('click', () => state.source && copy(state.source, 'page source'));

    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
        state.tab = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        $('tree').hidden = state.tab !== 'tree';
        $('searchBox').hidden = state.tab !== 'tree';
        $('sourceWrap').hidden = state.tab !== 'source';
        $('recordedWrap').hidden = state.tab !== 'recorded';
        renderSource();
        renderRecorded();
    }));

    // ── details ─────────────────────────────────────────────────────────
    function javaFor(loc, name) {
        return C.field(loc, { platform: state.platform, style: state.settings.style, name });
    }

    function verifyKey(s) {
        return JSON.stringify([s.using, s.value]);
    }

    function countBadge(s) {
        const key = verifyKey(s);
        if (state.verified.has(key)) {
            const c = state.verified.get(key);
            return `<span class="count server${c === 1 ? '' : ' many'}" title="Count from the device">${c === 1 ? '✓ device: unique' : c === 0 ? 'device: no match' : 'device: ' + c}</span>`;
        }
        return s.count === 1 ? '<span class="count unique">✓ unique</span>'
            : s.count > 1 ? `<span class="count many">${s.count} matches</span>`
                : s.count === 0 ? '<span class="count many">no match</span>' : '<span class="count unknown">?</span>';
    }

    function renderDetails() {
        const box = $('details');
        const n = state.selected;
        if (!n || !state.doc) {
            box.innerHTML = `<div class="empty-state small">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 7-6 2-2 6z"/></svg>
                <p class="title">Nothing selected</p>
                <p>Click an element on the screen or in the tree to see its attributes and Appium locators.</p></div>`;
            return;
        }
        const k = kindOf(n);
        const type = L.typeOf(n, state.platform);
        const text = L.titleOf(n, state.platform);
        const suggestions = L.suggest(n, ctx());
        const best = suggestions.find(s => s.count === 1) || suggestions[0];
        const c = center(n);
        const name = C.fieldName(L.nameSeed(n, state.platform), new Set());

        let html = `
            <div class="el-head">
                <span class="kind ${k.role}">${esc(k.label)}</span>
                <div><div class="name">${esc(L.shortType(type))}${text ? ' <span class="muted">“' + esc(text) + '”</span>' : ''}</div>
                <div class="full">${esc(type)}</div></div>
            </div>
            <div class="actions">
                <button data-act="tap" title="Tap the element centre (${Math.round(c.x)}, ${Math.round(c.y)})">${ICON.tap}Tap</button>
                <button data-act="longPress" title="Long-press the element centre">${ICON.hold}Long press</button>
                <div class="type-row">
                    <input id="typeText" placeholder="Text to type into this element…" spellcheck="false">
                    <button data-act="type" title="Find the element and send the text to it">${ICON.type}Type</button>
                </div>
            </div>`;

        html += `<div class="section-title">Locators</div>`;
        suggestions.forEach((s, i) => {
            html += `<div class="sel${s === best && s.count === 1 ? ' best' : ''}">
                <span class="k">${esc(s.label)}</span><code>${esc(s.value)}</code>
                <span class="meta">${countBadge(s)}
                    <button class="verify" data-verify="${i}" title="Count the matches on the device (findElements)">${ICON.device}</button>
                    <button data-copy="${attr(s.value)}" data-label="${attr(s.label)}" title="Copy the locator value">${ICON.copy}</button>
                    <button data-java="${i}" title="Copy as Java (${state.settings.style === 'appiumBy' ? 'AppiumBy' : '@' + (state.platform === 'ios' ? 'iOSXCUITFindBy' : 'AndroidFindBy')})">${ICON.java}</button>
                </span></div>`;
        });
        if (best && best.count !== 1) {
            html += `<p class="note">No locator is unique on this screen; the XPath with a position is the fallback. Prefer adding an accessibility id to the app.</p>`;
        }
        if (best) {
            const snippet = javaFor(best, name);
            html += `<div class="section-title">Java (${state.settings.style === 'appiumBy' ? 'AppiumBy' : 'page factory'}, java-client ${esc(state.settings.javaClient)})</div>
                <pre class="snippet">${javaHl(snippet)}<button data-copy="${attr(snippet)}" data-label="Java field">${ICON.copy}Copy</button></pre>`;
        }

        const xpath = L.absoluteXpath(n);
        html += `<div class="section-title attrs-head">Attributes <button class="link" data-copy="${attr(xpath)}" data-label="XPath">Copy XPath</button></div><div class="attrs">`;
        for (const a of Array.from(n.attributes)) {
            html += `<div class="key">${esc(a.name)}</div><div class="val" data-copy="${attr(a.value)}" data-label="${attr(a.name)}" title="Click to copy">${a.value === '' ? '<span class="muted">""</span>' : esc(a.value)}</div>`;
        }
        html += `</div>`;
        box.innerHTML = html;
        box.querySelectorAll('[data-java]').forEach(b => {
            const s = suggestions[Number(b.dataset.java)];
            b.onclick = () => s && copy(javaFor(s, name), 'Java locator');
        });
        box.querySelectorAll('[data-verify]').forEach(b => {
            const s = suggestions[Number(b.dataset.verify)];
            b.onclick = () => s && send({ type: 'verify', key: verifyKey(s), locator: { using: s.using, value: s.value } });
        });
    }

    $('details').addEventListener('click', e => {
        const t = e.target.closest('[data-copy],[data-act]');
        const n = state.selected;
        if (!t || !n) return;
        if (t.dataset.copy != null) return copy(t.dataset.copy, t.dataset.label || 'value');
        const c = center(n);
        switch (t.dataset.act) {
            case 'tap':
                recordElement(n, 'click', null, c);
                return send({ type: 'tap', x: c.x, y: c.y });
            case 'longPress':
                recordStep({ action: 'longPressAt', x: c.x, y: c.y });
                return send({ type: 'longPress', x: c.x, y: c.y });
            case 'type':
                return typeInto(n);
        }
    });
    $('details').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.id === 'typeText' && state.selected) typeInto(state.selected);
    });

    function typeInto(n) {
        const text = $('typeText').value;
        if (!text) return toast('Enter the text to type first');
        const loc = bestLocator(n);
        recordElement(n, 'sendKeys', text);
        const c = center(n);
        send({ type: 'type', text, locator: loc ? { using: loc.using, value: loc.value } : undefined, x: c.x, y: c.y });
    }

    // ── toolbar ─────────────────────────────────────────────────────────
    $('refresh').addEventListener('click', refresh);
    $('showBounds').addEventListener('change', renderBounds);
    document.querySelectorAll('[data-button]').forEach(b => b.addEventListener('click', () => {
        recordStep({ action: b.dataset.button });
        send({ type: b.dataset.button });
    }));
    document.querySelectorAll('[data-swipe]').forEach(b => b.addEventListener('click', () => send({ type: 'swipe', direction: b.dataset.swipe })));
    document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

    function refresh() {
        if (state.session) send({ type: 'refresh' });
    }

    function setMode(mode) {
        state.mode = mode;
        document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        screenEl.classList.toggle('tap-mode', mode === 'tap' || mode === 'record');
        screenEl.classList.toggle('inspect-mode', mode === 'inspect');
        document.body.classList.toggle('recording', mode === 'record');
        state.hovered = null;
        renderHover();
        persist();
    }

    document.addEventListener('keydown', e => {
        const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
        if (e.key === 'Escape') {
            if (typing) document.activeElement.blur(); else if (state.session) select(null, false);
            return;
        }
        if (typing || e.metaKey || e.ctrlKey || e.altKey || !state.session) return;
        if (e.key === 'r') refresh();
        else if (e.key === '/') { e.preventDefault(); $('search').focus(); }
        else if (e.key === 'i') setMode('inspect');
        else if (e.key === 't') setMode('tap');
        else if (e.key === 'e') setMode('record');
    });

    // ── resizable panes ─────────────────────────────────────────────────
    const panes = $('panes');
    if (saved.cols) saved.cols.forEach((w, i) => panes.style.setProperty('--col-' + i, w + 'px'));
    document.querySelectorAll('.resizer').forEach(handle => handle.addEventListener('mousedown', down => {
        const i = Number(handle.dataset.resize);
        const pane = handle.previousElementSibling;
        const start = pane.getBoundingClientRect().width;
        handle.classList.add('dragging');
        const move = e => {
            const w = Math.max(220, Math.min(panes.clientWidth - 420, start + e.clientX - down.clientX));
            panes.style.setProperty('--col-' + i, w + 'px');
        };
        const up = () => {
            handle.classList.remove('dragging');
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            saved.cols = [0, 1].map(k => document.querySelectorAll('.pane')[k].getBoundingClientRect().width);
            persist();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }));

    // ── helpers ─────────────────────────────────────────────────────────
    function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function attr(s) {
        return esc(s);
    }

    function javaHl(code) {
        return esc(code)
            .replace(/(&quot;(?:\\.|(?!&quot;).)*?&quot;)|(@\w+)|\b(import|public|private|static|final|class|void|new|this)\b|(\/\/[^\n]*)/g,
                (m, str, ann, kw, comment) => `<span class="${str ? 'str' : ann ? 'ann' : kw ? 'kw' : 'r'}">${m}</span>`);
    }

    function jsonHl(json) {
        return esc(json)
            .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2')
            .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="s">$2</span>')
            .replace(/(:\s*)(true|false|null|-?\d+(?:\.\d+)?)/g, '$1<span class="n">$2</span>');
    }

    // Only an inline PNG or JPEG data URL may become an image source.
    function imageSrc(s) {
        return /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(String(s || '')) ? s : '';
    }

    setMode(state.mode);
    writeForm();
    renderTree();
    renderDetails();
    send({ type: 'ready' });
})();
