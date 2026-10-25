import * as vscode from 'vscode';
import { AppiumServer, InstalledDriver, ServerInfo, ServerOptions } from './appium/server';
import { DeviceInfo, listDevices } from './devices';
import { bootSimulator } from './devices/simctl';

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
        this.state = { server: this.server.current, busy: false, devices: [], deviceNotes: [], devicesLoading: false, platform: process.platform };
        this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
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
            await Promise.all([this.refreshDevices(), this.state.drivers ? Promise.resolve() : this.refreshAppium()]);
        } catch (e) {
            this.fail(e);
        } finally {
            this.update({ busy: false });
        }
    }

    async stop() {
        if (this.state.busy) {
            return;
        }
        if (this.state.server.state === 'external') {
            void vscode.window.showWarningMessage(`The Appium server at ${this.server.url} was not started by TestFly; stop it where it runs.`);
            return;
        }
        this.update({ busy: true, error: undefined });
        try {
            await this.server.stop();
        } catch (e) {
            this.fail(e);
        } finally {
            this.update({ busy: false });
        }
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
