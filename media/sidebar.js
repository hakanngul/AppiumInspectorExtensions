// TestFly Appium sidebar: Appium server card, installed drivers and devices. State comes from the extension host.
(function () {
    'use strict';
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    let state;
    let url = '';

    const ICONS = {
        play: '<path d="M5 3.5v9l7-4.5z"/>',
        stop: '<rect x="4" y="4" width="8" height="8" rx="1.2"/>',
        android: '<path d="M4.5 7h7v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z"/><path d="M4.5 6.5a3.5 3.5 0 0 1 7 0"/><path d="M5.5 3l1 1.6M10.5 3l-1 1.6"/><path d="M3 7.5v3M13 7.5v3"/>',
        ios: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.8"/><path d="M7 12h2"/>',
        sim: '<rect x="2" y="2.5" width="12" height="9" rx="1.2"/><path d="M6 14h4M8 11.5V14"/>',
        driver: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>',
    };

    const SERVER_TEXT = {
        stopped: 'Stopped',
        starting: 'Starting…',
        running: 'Running (started here)',
        external: 'Running (started elsewhere)',
        stopping: 'Stopping…',
    };

    window.addEventListener('message', e => {
        if (e.origin !== window.location.origin || !e.data || e.data.type !== 'state') return;
        state = e.data.state;
        url = e.data.url;
        render();
    });

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function icon(name, extra) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        node.setAttribute('viewBox', '0 0 16 16');
        node.setAttribute('class', 'ic' + (extra ? ' ' + extra : ''));
        node.innerHTML = ICONS[name];
        return node;
    }

    function chip(text, kind) {
        return el('span', 'chip ' + kind, text);
    }

    function render() {
        renderServer();
        renderDrivers();
        renderDevices();
    }

    function renderServer() {
        const s = state.server;
        const busy = state.busy || s.state === 'starting' || s.state === 'stopping';
        $('serverDot').dataset.state = s.state;
        $('serverState').textContent = SERVER_TEXT[s.state] || s.state;
        const version = s.version || (s.state === 'stopped' && state.appiumVersion ? state.appiumVersion + ' installed' : '');
        $('serverVersion').hidden = !version;
        $('serverVersion').textContent = version ? (s.version ? 'v' + s.version : version) : '';
        $('serverUrl').textContent = url;
        $('serverUrl').title = url;

        const button = $('serverButton');
        const running = s.state === 'running' || s.state === 'external';
        button.disabled = busy || s.state === 'external';
        button.classList.toggle('primary', !running);
        button.classList.toggle('danger', s.state === 'running');
        $('serverIcon').innerHTML = running ? ICONS.stop : ICONS.play;
        $('serverButtonText').textContent = s.state === 'starting' ? 'Starting Appium…'
            : s.state === 'stopping' ? 'Stopping Appium…'
            : s.state === 'external' ? 'Started elsewhere'
            : running ? 'Stop Appium' : 'Start Appium';
        button.title = s.state === 'external' ? 'This server was not started by TestFly; stop it where it runs.' : '';

        const error = state.error || s.message;
        $('serverError').hidden = !error || running;
        $('serverError').textContent = error || '';
    }

    function renderDrivers() {
        const box = $('drivers');
        box.innerHTML = '';
        if (state.driversError) {
            box.append(el('p', 'hint', state.driversError));
            return;
        }
        if (!state.drivers) {
            box.append(el('p', 'hint', 'Reading installed drivers…'));
            return;
        }
        const wanted = [{ name: 'uiautomator2', label: 'UiAutomator2', platform: 'Android' }];
        if (state.platform === 'darwin') wanted.push({ name: 'xcuitest', label: 'XCUITest', platform: 'iOS' });
        const shown = new Set();
        for (const w of wanted) {
            const d = state.drivers.find(x => x.name === w.name);
            shown.add(w.name);
            box.append(driverRow(w.label, d ? `${w.platform} · ${d.version}` : `${w.platform} · not installed`, d, w.name));
        }
        for (const d of state.drivers) {
            if (!shown.has(d.name)) box.append(driverRow(d.automationName || d.name, `${d.platforms.join(', ')} · ${d.version}`, d, d.name));
        }
    }

    function driverRow(label, sub, installed, name) {
        const row = el('div', 'row' + (installed ? '' : ' disabled'));
        row.append(icon('driver'));
        const text = el('div', 'text');
        text.append(el('span', 'name', label), el('span', 'sub', sub));
        row.append(text);
        if (installed) {
            row.append(chip('Installed', 'ok'));
        } else {
            const command = `appium driver install ${name}`;
            const copy = el('button', '', 'Copy install');
            copy.title = command;
            copy.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: command, label: command }));
            row.append(copy);
        }
        return row;
    }

    function renderDevices() {
        const box = $('devices');
        box.innerHTML = '';
        $('reloadDevices').disabled = state.devicesLoading;
        $('reloadDevices').textContent = state.devicesLoading ? 'Loading…' : 'Reload';
        const groups = [
            ['Android', state.devices.filter(d => d.platform === 'android')],
            ['iOS simulators', state.devices.filter(d => d.platform === 'ios' && d.kind === 'simulator')],
            ['iOS devices', state.devices.filter(d => d.platform === 'ios' && d.kind === 'real')],
        ].filter(([, list]) => list.length);
        if (!groups.length) {
            box.append(el('p', 'hint', state.devicesLoading ? 'Looking for devices…' : 'No device found. Start an emulator or simulator, or connect a device, then reload.'));
        }
        for (const [title, list] of groups) {
            box.append(el('div', 'group-title', title));
            for (const d of list) box.append(deviceRow(d));
        }
        const notes = $('deviceNotes');
        notes.innerHTML = '';
        for (const note of state.deviceNotes) notes.append(el('p', 'hint', note));
    }

    function deviceRow(d) {
        const usable = d.state === 'ready' || d.state === 'shutdown' || d.state === 'booting';
        const row = el('div', 'row' + (usable ? '' : ' disabled'));
        row.title = d.reason || `appium:udid = ${d.id}`;
        row.append(icon(d.platform === 'android' ? 'android' : d.kind === 'simulator' ? 'sim' : 'ios', d.platform));
        const text = el('div', 'text');
        const kind = d.kind === 'emulator' ? 'Emulator' : d.kind === 'simulator' ? 'Simulator' : 'Device';
        const os = d.platform === 'android' ? 'Android' : 'iOS';
        text.append(el('span', 'name', d.name), el('span', 'sub', [d.version ? `${os} ${d.version}` : os, kind, d.id].join(' · ')));
        row.append(text);
        if (d.state === 'ready') {
            row.append(chip('Ready', 'ok'));
        } else if (d.state === 'booting') {
            row.append(chip('Booting', 'info'));
        } else if (d.state === 'shutdown') {
            const boot = el('button', '', 'Boot');
            boot.title = 'Boot this simulator';
            boot.addEventListener('click', () => vscode.postMessage({ type: 'boot', id: d.id }));
            row.append(boot);
        } else {
            row.append(chip(d.state, d.state === 'unauthorized' ? 'warn' : 'err'));
        }
        return row;
    }

    $('serverButton').addEventListener('click', () => {
        const s = state && state.server.state;
        vscode.postMessage({ type: s === 'running' ? 'stop' : 'start' });
    });
    $('copyUrl').addEventListener('click', () => vscode.postMessage({ type: 'copy', text: url, label: 'server URL' }));
    $('showLog').addEventListener('click', () => vscode.postMessage({ type: 'log' }));
    $('reloadDevices').addEventListener('click', () => vscode.postMessage({ type: 'reloadDevices' }));
    $('reloadDrivers').addEventListener('click', () => vscode.postMessage({ type: 'reloadDrivers' }));
    document.addEventListener('click', e => {
        if (e.target.closest('[data-settings]')) vscode.postMessage({ type: 'settings' });
    });
    vscode.postMessage({ type: 'ready' });
})();
