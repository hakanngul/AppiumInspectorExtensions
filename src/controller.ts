import * as vscode from 'vscode';
import { AppiumServer, InstalledDriver, ServerInfo, ServerOptions } from './appium/server';
import { InspectorSession } from './appium/session';
import { DeviceInfo, listDevices } from './devices';
import { bootSimulator } from './devices/simctl';
import { appiumPortUses, PortUse, stopProcess } from './ports';

export const SECTION = 'testflyAppiumInspector';

export interface ControllerState {
    server: ServerInfo;
    /** True while start or stop runs. */
    busy: boolean;
    error?: string;
    appiumVersion?: string;
    drivers?: InstalledDriver[];
    driversError?: string;
    devices: DeviceInfo[];
    deviceNotes: string[];
    devicesLoading: boolean;
    platform: NodeJS.Platform;
    /** Processes listening on Appium's ports (server, WebDriverAgent, MJPEG, UiAutomator2). */
    ports: (PortUse & { label: string; own: boolean })[];
    portsError?: string;
}

/** Owns the Appium server and the device list for the window; the sidebar and the commands drive it. */
export class AppiumController implements vscode.Disposable {
    readonly output = vscode.window.createOutputChannel('TestFly Appium');
    private server: AppiumServer;
    private readonly changed = new vscode.EventEmitter<ControllerState>();
    readonly onDidChange = this.changed.event;
    private state: ControllerState;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor() {
        this.server = this.createServer();
        this.state = { server: this.server.current, busy: false, devices: [], deviceNotes: [], devicesLoading: false, platform: process.platform, ports: [] };
        this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${SECTION}.ios.preferDevicectl`) && this.server.owned) {
                void vscode.window.showInformationMessage('Restart Appium to apply testflyAppiumInspector.ios.preferDevicectl.', 'Restart Appium').then(async choice => {
                    if (choice) {
                        await this.stop();
                        this.server = this.createServer();
                        this.update({ server: this.server.current });
                        await this.start();
                    }
                });
            }
            if (e.affectsConfiguration(`${SECTION}.appium`)) {
                void this.applyServerSettings();
            }
            if (e.affectsConfiguration(`${SECTION}.adbPath`)) {
                void this.refreshDevices();
            }
        }));
    }

    get current(): ControllerState {
        return this.state;
    }

    get serverUrl(): string {
        return this.server.url;
    }

    private update(patch: Partial<ControllerState>) {
        this.state = { ...this.state, ...patch };
        this.changed.fire(this.state);
    }

    private options(): ServerOptions {
        const cfg = vscode.workspace.getConfiguration(SECTION);
        return {
            appiumPath: cfg.get('appium.path', 'appium'),
            host: cfg.get('appium.host', '127.0.0.1'),
            port: cfg.get('appium.port', 4723),
            basePath: cfg.get('appium.basePath', '/'),
            allowCors: cfg.get('appium.allowCors', true),
            // XCUITest finds real iPhones through usbmux or the iOS 18+ tunnel registry by default; this extension lists
            // them with devicectl. The driver's own switch makes it use devicectl too, so both see the same devices.
            // Off by default: with it, XCUITest also takes the simulators devicectl lists for real devices.
            env: cfg.get('ios.preferDevicectl', false) ? { APPIUM_XCUITEST_PREFER_DEVICECTL: '1' } : {},
        };
    }

    private createServer(): AppiumServer {
        const log = (line: string) => this.output.appendLine(line);
        const onChange = (info: ServerInfo) => this.update({ server: info });
        try {
            return new AppiumServer(this.options(), log, onChange);
        } catch (e) {
            void vscode.window.showErrorMessage(`${(e as Error).message}. The default Appium address is used.`);
            return new AppiumServer({ appiumPath: 'appium', host: '127.0.0.1', port: 4723, basePath: '/', allowCors: true }, log, onChange);
        }
    }

    /** New address or path: a server this extension runs keeps running until it is stopped; otherwise switch at once. */
    private async applyServerSettings() {
        if (this.server.owned) {
            void vscode.window.showInformationMessage('Appium settings changed. Stop and start the server to use them.');
            return;
        }
        this.server = this.createServer();
        this.update({ server: this.server.current, appiumVersion: undefined, drivers: undefined, driversError: undefined });
        await this.checkServer();
        await this.refreshAppium();
    }

    async checkServer(): Promise<ServerInfo> {
        return this.server.check();
    }

    async start() {
        if (this.state.busy) {
            return;
        }
        this.update({ busy: true, error: undefined });
        try {
            const info = await this.server.start();
            if (info.state === 'external') {
                void vscode.window.showInformationMessage(`An Appium server already runs at ${info.url}; it is used as is.`);
            }
            await Promise.all([this.refreshDevices(), this.refreshPorts(), this.state.drivers ? Promise.resolve() : this.refreshAppium()]);
        } catch (e) {
            this.fail(e);
        } finally {
            this.update({ busy: false });
        }
    }

    async stop(): Promise<void> {
        if (this.state.busy) {
            return;
        }
        if (this.state.server.state === 'external') {
            // Started outside VS Code: stop the process that listens on the server's port, after asking.
            await this.refreshPorts();
            const holder = this.state.ports.find(p => p.port === this.server.options.port);
            if (!holder) {
                void vscode.window.showWarningMessage(`No process was found on port ${this.server.options.port}; stop the Appium server where it runs.`);
                return;
            }
            await this.stopPort(holder.pid);
            return;
        }
        this.update({ busy: true, error: undefined });
        try {
            await this.server.stop();
        } catch (e) {
            this.fail(e);
        } finally {
            this.update({ busy: false });
            void this.refreshPorts();
        }
    }

    private portsBusy = false;

    /** Who listens on Appium's ports: shown in the sidebar, so that a leftover server or WebDriverAgent can be stopped. */
    async refreshPorts() {
        if (this.portsBusy) {
            return;
        }
        this.portsBusy = true;
        try {
            const own = this.server.pid;
            const ports = (await appiumPortUses(this.server.options.port)).map(p => ({ ...p, own: p.pid === own }));
            if (JSON.stringify(ports) !== JSON.stringify(this.state.ports) || this.state.portsError) {
                this.update({ ports, portsError: undefined });
            }
        } catch (e) {
            this.update({ ports: [], portsError: (e as Error).message });
        } finally {
            this.portsBusy = false;
        }
    }

    /** Stops the process holding an Appium port, after asking; the server this extension started is stopped normally. */
    async stopPort(pid: number): Promise<boolean> {
        const uses = this.state.ports.filter(p => p.pid === pid);
        if (pid === this.server.pid) {
            await this.stop();
            return !this.server.owned;
        }
        const what = uses.length ? `${uses[0].command || 'process'} (pid ${pid}) on port ${uses.map(u => u.port).join(', ')} — ${uses[0].label}` : `process ${pid}`;
        const choice = await vscode.window.showWarningMessage(`Stop ${what}?`, { modal: true, detail: 'It was not started by this extension. Unsaved work in that process is lost.' }, 'Stop process');
        if (choice !== 'Stop process') {
            return false;
        }
        let stopped = false;
        try {
            await stopProcess(pid);
            this.output.appendLine(`Stopped ${what}`);
            stopped = true;
        } catch (e) {
            this.fail(e);
        }
        await Promise.all([this.refreshPorts(), this.checkServer()]);
        return stopped;
    }

    /**
     * A clean server with the current settings: stops whatever holds the server port (asking first when this extension
     * did not start it, e.g. a server left over from an earlier VS Code window or version), then starts a new one.
     */
    async restart(): Promise<void> {
        await this.checkServer();
        if (this.server.owned) {
            await this.stop();
        } else if (this.state.server.state === 'external') {
            await this.refreshPorts();
            const holder = this.state.ports.find(p => p.port === this.server.options.port);
            if (holder && !(await this.stopPort(holder.pid))) {
                return;
            }
        }
        // settings may have changed while an older server ran
        this.server.dispose();
        this.server = this.createServer();
        this.update({ server: this.server.current });
        await this.start();
    }

    /** Appium version and installed drivers, from the Appium CLI. */
    async refreshAppium() {
        try {
            const appiumVersion = await this.server.version();
            this.update({ appiumVersion });
            const drivers = await this.server.drivers();
            this.update({ drivers, driversError: undefined });
        } catch (e) {
            this.update({ drivers: undefined, driversError: (e as Error).message });
        }
    }

    async refreshDevices() {
        if (this.state.devicesLoading) {
            return;
        }
        this.update({ devicesLoading: true });
        try {
            const { devices, notes } = await listDevices({ adbPath: vscode.workspace.getConfiguration(SECTION).get('adbPath', '') });
            this.update({ devices, deviceNotes: notes });
        } catch (e) {
            this.update({ devices: [], deviceNotes: [(e as Error).message] });
        } finally {
            this.update({ devicesLoading: false });
        }
    }

    /** A new Appium session on the server this controller manages. */
    newSession(device: DeviceInfo, capabilities: Record<string, unknown>): Promise<InspectorSession> {
        return InspectorSession.open(this.server.client, device, capabilities);
    }

    async boot(udid: string) {
        const device = this.state.devices.find(d => d.id === udid);
        this.update({ devices: this.state.devices.map(d => (d.id === udid ? { ...d, state: 'booting' } : d)) });
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Booting ${device?.name ?? udid}…` },
                () => bootSimulator(udid));
        } catch (e) {
            this.fail(e);
        }
        await this.refreshDevices();
    }

    private fail(e: unknown) {
        const message = (e as Error).message;
        this.output.appendLine(`Error: ${message}`);
        this.update({ error: message });
        void vscode.window.showErrorMessage(message, 'Show log').then(choice => {
            if (choice) {
                this.output.show(true);
            }
        });
    }

    dispose() {
        this.server.dispose();
        this.changed.dispose();
        this.output.dispose();
        this.subscriptions.forEach(s => s.dispose());
    }
}
