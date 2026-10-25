import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AppiumError } from './appium/client';
import { AppInput, buildCapabilities, capabilityProblems, CapabilityInput, capabilityWarnings, parseExtraCapabilities } from './appium/capabilities';
import { Direction } from './appium/gestures';
import { InspectorSession, Locator } from './appium/session';
import { checkAppFile } from './apps';
import { AppiumController, ControllerState, SECTION } from './controller';
import { InstalledApp, launchActivity, listInstalledApps } from './devices/installedApps';
import { DeviceInfo } from './devices/types';
import { webviewHtml } from './webview';

const PROFILES_KEY = `${SECTION}.profiles`;

export interface SessionForm {
    deviceId: string;
    app: AppInput;
    extra: string;
}

export interface Profile extends SessionForm {
    name: string;
}

/** Messages the webview sends; see media/inspector.js. */
type Inbound =
    | { type: 'ready' }
    | { type: 'preview'; form: SessionForm }
    | { type: 'startSession'; form: SessionForm }
    | { type: 'endSession' }
    | { type: 'pickApp'; platform: string; kind: string }
    | { type: 'server'; action: 'start' | 'stop' }
    | { type: 'reloadDevices' }
    | { type: 'listApps'; deviceId: string; force?: boolean }
    | { type: 'resolveActivity'; deviceId: string; package: string }
    | { type: 'boot'; id: string }
    | { type: 'refresh' }
    | { type: 'tap' | 'longPress'; x: number; y: number }
    | { type: 'swipe'; direction: Direction }
    | { type: 'type'; text: string; locator?: Locator; x?: number; y?: number }
    | { type: 'back' | 'home' }
    | { type: 'verify'; key: string; locator: Locator }
    | { type: 'find'; locator: Locator }
    | { type: 'saveProfile'; form: SessionForm }
    | { type: 'deleteProfile'; name: string }
    | { type: 'copy'; text: string; label: string }
    | { type: 'openJava'; code: string };

/** The Appium Inspector panel: session setup, screen, UI tree, element details and locators. One per window. */
export class InspectorPanel {
    private static current?: InspectorPanel;
    private readonly panel: vscode.WebviewPanel;
    private session?: InspectorSession;
    private busy = false;
    /** Installed apps per device, read once per panel unless reloaded. */
    private readonly apps = new Map<string, Promise<InstalledApp[]>>();
    /** Launcher activities per device and package (`-a MAIN -c LAUNCHER`), read once per panel. */
    private readonly launchers = new Map<string, Promise<string | undefined>>();
    private previewSeq = 0;
    private readonly subscriptions: vscode.Disposable[] = [];

    static show(context: vscode.ExtensionContext, controller: AppiumController, deviceId?: string) {
        if (InspectorPanel.current) {
            InspectorPanel.current.panel.reveal();
            if (deviceId) {
                InspectorPanel.current.post({ type: 'chooseDevice', id: deviceId });
            }
            return;
        }
        InspectorPanel.current = new InspectorPanel(context, controller, deviceId);
    }

    static disposeCurrent() {
        InspectorPanel.current?.panel.dispose();
    }

    private constructor(private readonly context: vscode.ExtensionContext, private readonly controller: AppiumController, private readonly initialDevice?: string) {
        this.panel = vscode.window.createWebviewPanel('testflyAppiumInspector.inspector', 'Appium Inspector', vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        });
        this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
        this.panel.webview.html = webviewHtml(this.panel.webview, context.extensionUri, {
            title: 'Appium Inspector',
            styles: ['inspector.css', 'session.css'],
            scripts: ['locators.js', 'codegen.js', 'inspector.js'],
            body: fs.readFileSync(path.join(context.extensionPath, 'media', 'body.html'), 'utf8'),
        });
        this.panel.webview.onDidReceiveMessage(m => this.handle(m as Inbound), undefined, this.subscriptions);
        this.panel.onDidDispose(() => this.dispose(), undefined, this.subscriptions);
        this.subscriptions.push(controller.onDidChange(state => this.postEnvironment(state)));
        this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${SECTION}.codegen`)) {
                this.post({ type: 'settings', settings: this.settings() });
            }
        }));
    }

    private post(message: unknown) {
        void this.panel.webview.postMessage(message);
    }

    private settings() {
        const cfg = vscode.workspace.getConfiguration(SECTION);
        return {
            javaClient: cfg.get<string>('codegen.javaClient', '11'),
            style: cfg.get<string>('codegen.style', 'pageFactory'),
        };
    }

    private postEnvironment(state: ControllerState = this.controller.current) {
        this.post({ type: 'environment', server: state.server, busy: state.busy, devices: state.devices, devicesLoading: state.devicesLoading, platform: state.platform });
    }

    private profiles(): Profile[] {
        return this.context.globalState.get<Profile[]>(PROFILES_KEY, []);
    }

    private status(state: 'ok' | 'loading' | 'error' | 'idle', message: string) {
        this.post({ type: 'status', state, message });
    }

    private async handle(m: Inbound) {
        try {
            switch (m.type) {
                case 'ready':
                    this.postEnvironment();
                    this.post({ type: 'profiles', profiles: this.profiles() });
                    this.post({ type: 'settings', settings: this.settings() });
                    if (this.initialDevice) {
                        this.post({ type: 'chooseDevice', id: this.initialDevice });
                    }
                    if (this.session && !this.session.isClosed) {
                        this.post({ type: 'session', device: this.session.device, capabilities: this.session.capabilities });
                        await this.refresh();
                    } else {
                        await this.controller.checkServer();
                        if (!this.controller.current.devices.length) {
                            await this.controller.refreshDevices();
                        }
                    }
                    return;
                case 'preview': {
                    // previews are asynchronous now (the launcher activity); only the newest one is shown
                    const seq = ++this.previewSeq;
                    const prepared = await this.prepare(m.form);
                    return seq === this.previewSeq ? this.post({ type: 'preview', ...prepared }) : undefined;
                }
                case 'startSession':
                    return await this.startSession(m.form);
                case 'endSession':
                    return await this.endSession();
                case 'pickApp':
                    return await this.pickApp(m.platform, m.kind);
                case 'server':
                    return m.action === 'start' ? await this.controller.start() : await this.controller.stop();
                case 'reloadDevices':
                    return await this.controller.refreshDevices();
                case 'listApps':
                    return await this.listApps(m.deviceId, m.force);
                case 'resolveActivity': {
                    const activity = await this.launcher(m.deviceId, m.package);
                    return this.post({ type: 'activity', deviceId: m.deviceId, package: m.package, activity });
                }
                case 'boot':
                    return await this.controller.boot(m.id);
                case 'refresh':
                    return await this.refresh();
                case 'tap':
                    return await this.act(s => s.tap({ x: m.x, y: m.y }), 'Tapping…');
                case 'longPress':
                    return await this.act(s => s.longPress({ x: m.x, y: m.y }), 'Long-pressing…');
                case 'swipe':
                    return await this.act(async s => {
                        const [from, to] = await s.swipeDirection(m.direction);
                        this.post({ type: 'swiped', direction: m.direction, from, to });
                    }, `Swiping ${m.direction}…`);
                case 'type':
                    return await this.act(async s => {
                        if (!m.locator && m.x !== undefined && m.y !== undefined) {
                            await s.tap({ x: m.x, y: m.y });
                            await new Promise(r => setTimeout(r, 300)); // let the field take focus
                        }
                        await s.type(m.text, m.locator);
                    }, 'Typing…');
                case 'back':
                    return await this.act(s => s.back(), 'Going back…');
                case 'home':
                    return await this.act(s => s.home(), 'Going home…');
                case 'verify': {
                    const count = await this.requireSession().count(m.locator);
                    return this.post({ type: 'verified', key: m.key, count });
                }
                case 'find': {
                    this.status('loading', 'Searching on the device…');
                    const rects = await this.requireSession().find(m.locator);
                    this.post({ type: 'found', locator: m.locator, rects });
                    return this.status('ok', `${rects.length} element${rects.length === 1 ? '' : 's'} found on the device`);
                }
                case 'saveProfile':
                    return await this.saveProfile(m.form);
                case 'deleteProfile':
                    await this.context.globalState.update(PROFILES_KEY, this.profiles().filter(p => p.name !== m.name));
                    return this.post({ type: 'profiles', profiles: this.profiles() });
                case 'copy':
                    await vscode.env.clipboard.writeText(m.text);
                    vscode.window.setStatusBarMessage(`$(check) Copied ${m.label}`, 2500);
                    return;
                case 'openJava': {
                    const doc = await vscode.workspace.openTextDocument({ language: 'java', content: m.code });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    return;
                }
            }
        } catch (e) {
            this.fail(e);
        }
    }

    private launcher(deviceId: string, pkg: string): Promise<string | undefined> {
        const key = `${deviceId}/${pkg}`;
        if (!this.launchers.has(key)) {
            const adb = vscode.workspace.getConfiguration(SECTION).get('adbPath', '');
            this.launchers.set(key, launchActivity(adb, deviceId, pkg).catch(() => undefined));
        }
        return this.launchers.get(key)!;
    }

    /** Capabilities for the form, and the problems that would make Appium refuse them. */
    private async prepare(form: SessionForm): Promise<{ capabilities?: Record<string, unknown>; problems: string[]; warnings: string[]; notes: string[]; device?: DeviceInfo }> {
        const device = this.controller.current.devices.find(d => d.id === form.deviceId);
        if (!device) {
            return { problems: ['Choose a device.'], warnings: [], notes: [] };
        }
        const extra = parseExtraCapabilities(form.extra);
        const cfg = vscode.workspace.getConfiguration(SECTION);
        const notes: string[] = [];
        const warnings: string[] = [];
        let app = form.app;
        // Android, installed app: the launcher activity comes from the device with the LAUNCHER category. Appium's own
        // lookup (resolve-activity without a category) can land on an activity that does not start, e.g. a disabled alias.
        if (app.kind === 'installed' && device.platform === 'android' && device.state === 'ready' && app.appPackage?.trim()) {
            const found = await this.launcher(device.id, app.appPackage.trim());
            const typed = app.appActivity?.trim();
            if (found && !typed) {
                app = { ...app, appActivity: found };
                notes.push(`App activity from the device: ${found}`);
            } else if (found && typed && !sameActivity(typed, found, app.appPackage.trim())) {
                warnings.push(`The device starts ${app.appPackage.trim()} with ${found}; "${typed}" may not exist. Empty the activity field to use the device's.`);
            }
        }
        const input: CapabilityInput = {
            device,
            app,
            extra: extra.value,
            signing: {
                xcodeOrgId: cfg.get('ios.xcodeOrgId', ''),
                xcodeSigningId: cfg.get('ios.xcodeSigningId', 'Apple Development'),
                updatedWDABundleId: cfg.get('ios.updatedWDABundleId', ''),
            },
        };
        const problems = capabilityProblems(input);
        warnings.push(...capabilityWarnings(input));
        if (extra.error) {
            problems.push(extra.error);
        }
        if (form.app.kind === 'file' && form.app.path.trim()) {
            const check = checkAppFile(form.app.path, device);
            if (check.error) {
                problems.push(check.error);
            }
            if (check.warning) {
                warnings.push(check.warning);
            }
            if (!fs.existsSync(form.app.path)) {
                problems.push(`The app file does not exist: ${form.app.path}`);
            }
        }
        if (device.state === 'shutdown') {
            problems.push(`${device.name} is shut down. Boot it first.`);
        }
        return { capabilities: buildCapabilities(input), problems, warnings, notes, device };
    }

    private async startSession(form: SessionForm) {
        if (this.busy) {
            return;
        }
        const prepared = await this.prepare(form);
        if (prepared.problems.length || !prepared.capabilities || !prepared.device) {
            this.post({ type: 'preview', ...prepared });
            throw new Error(prepared.problems.join(' '));
        }
        this.busy = true;
        try {
            await this.endSession(true);
            const server = this.controller.current.server;
            if (server.state !== 'running' && server.state !== 'external') {
                this.status('loading', 'Starting Appium…');
                await this.controller.start();
                const now = this.controller.current.server;
                if (now.state !== 'running' && now.state !== 'external') {
                    throw new Error(this.controller.current.error ?? 'The Appium server did not start.');
                }
            }
            const device = prepared.device;
            this.status('loading', `Starting a session on ${device.name}…${device.platform === 'ios' ? ' The first iOS session builds WebDriverAgent and can take minutes.' : ''}`);
            this.controller.output.appendLine(`New session on ${device.name}: ${JSON.stringify(prepared.capabilities)}`);
            this.session = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Appium: starting a session on ${device.name}…`, cancellable: false },
                () => this.controller.newSession(device, prepared.capabilities!));
            this.controller.output.appendLine(`Session ${this.session.id} started`);
            this.post({ type: 'session', device, capabilities: this.session.capabilities });
        } finally {
            this.busy = false;
        }
        await this.refresh();
    }

    private async endSession(quiet = false) {
        const s = this.session;
        this.session = undefined;
        if (s) {
            await s.close();
            this.controller.output.appendLine(`Session ${s.id} ended`);
        }
        if (!quiet) {
            this.post({ type: 'sessionEnded' });
        }
    }

    /** Posts the apps installed on a ready device; a failure is shown under the field, not as an error. */
    private async listApps(deviceId: string, force = false) {
        const device = this.controller.current.devices.find(d => d.id === deviceId);
        if (!device || device.state !== 'ready') {
            return this.post({ type: 'apps', deviceId, apps: [], error: device ? 'Boot the device to list its apps.' : '' });
        }
        if (force || !this.apps.has(deviceId)) {
            this.apps.set(deviceId, listInstalledApps(device, vscode.workspace.getConfiguration(SECTION).get('adbPath', '')));
        }
        try {
            this.post({ type: 'apps', deviceId, apps: await this.apps.get(deviceId)! });
        } catch (e) {
            this.apps.delete(deviceId);
            this.controller.output.appendLine(`Listing apps on ${device.name} failed: ${(e as Error).message}`);
            this.post({ type: 'apps', deviceId, apps: [], error: `Could not list the apps: ${(e as Error).message}` });
        }
    }

    private async pickApp(platform: string, kind: string) {
        const filters: Record<string, string[]> = platform === 'android'
            ? { 'Android app': ['apk'] }
            : kind === 'real' ? { 'iOS app': ['ipa', 'app', 'zip'] } : { 'iOS simulator app': ['app', 'zip'] };
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            // An .app is a folder on macOS; the dialog lets it be picked as a file there, elsewhere as a folder.
            canSelectFolders: platform === 'ios' && process.platform !== 'darwin',
            filters,
            title: 'Choose the app for the Appium session',
        });
        if (picked?.[0]) {
            this.post({ type: 'appPicked', path: picked[0].fsPath });
        }
    }

    private async saveProfile(form: SessionForm) {
        const name = await vscode.window.showInputBox({ title: 'Save session profile', prompt: 'Profile name', value: '' });
        if (!name?.trim()) {
            return;
        }
        const profiles = this.profiles().filter(p => p.name !== name.trim());
        profiles.unshift({ ...form, name: name.trim() });
        await this.context.globalState.update(PROFILES_KEY, profiles.slice(0, 30));
        this.post({ type: 'profiles', profiles: this.profiles(), selected: name.trim() });
    }

    private requireSession(): InspectorSession {
        if (!this.session || this.session.isClosed) {
            throw new Error('Start a session first.');
        }
        return this.session;
    }

    private async refresh() {
        const s = this.requireSession();
        this.status('loading', `Reading ${s.device.name}…`);
        const capture = await s.capture(shot => this.post({ type: 'shot', screenshot: shot }));
        this.post({ type: 'screen', ...capture });
    }

    private async act(action: (s: InspectorSession) => Promise<unknown>, message: string) {
        const s = this.requireSession();
        this.status('loading', message);
        await action(s);
        if (vscode.workspace.getConfiguration(SECTION).get('autoRefreshAfterAction', true)) {
            await new Promise(r => setTimeout(r, 400)); // let the UI settle (animations, navigation)
            await this.refresh();
        } else {
            this.status('ok', 'Done');
        }
    }

    private fail(e: unknown) {
        let message = (e as Error).message;
        if (/Unknown device or simulator UDID/.test(message)) {
            message += this.controller.current.server.state === 'external'
                ? ' The Appium server was started outside VS Code: start it with APPIUM_XCUITEST_PREFER_DEVICECTL=1, or stop it and press Start Appium here. Connect the iPhone with a cable.'
                : ' Connect the iPhone with a cable, unlock it and trust this Mac. If the server was started before this setting, stop and start Appium again.';
        }
        if (e instanceof AppiumError && e.stacktrace) {
            this.controller.output.appendLine(e.stacktrace);
        }
        if (e instanceof AppiumError && (e.invalidSession || e.unreachable) && this.session) {
            this.session = undefined;
            this.post({ type: 'sessionEnded', message: e.unreachable ? 'The Appium server is not reachable any more. Start it and a new session.' : 'The session ended (timeout or crash). Start a new session.' });
        }
        this.controller.output.appendLine(`Error: ${message}`);
        this.post({ type: 'error', message });
    }

    private dispose() {
        InspectorPanel.current = undefined;
        void this.session?.close();
        this.session = undefined;
        this.subscriptions.forEach(s => s.dispose());
    }
}

/** `.Main`, `com.app.Main` and `com.app/.Main` name the same activity of package `com.app`. */
export function sameActivity(a: string, b: string, pkg: string): boolean {
    const full = (x: string) => {
        const name = x.includes('/') ? x.slice(x.indexOf('/') + 1) : x;
        return name.startsWith('.') ? pkg + name : name;
    };
    return full(a) === full(b);
}
