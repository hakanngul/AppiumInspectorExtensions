import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AppiumController, ControllerState, SECTION } from './controller';
import { InspectorPanel } from './inspectorPanel';
import { webviewHtml } from './webview';

/** Messages the sidebar sends; see media/sidebar.js. */
type Inbound =
    | { type: 'ready' | 'start' | 'stop' | 'restart' | 'log' | 'settings' | 'reloadDevices' | 'reloadDrivers' }
    | { type: 'boot'; id: string }
    | { type: 'inspect'; id?: string }
    | { type: 'stopPort'; pid: number }
    | { type: 'reloadPorts' }
    | { type: 'copy'; text: string; label: string };

const STATUS_POLL_MS = 5_000;

/** The activity-bar view: Appium server, installed drivers and devices. */
export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = `${SECTION}.home`;
    private view?: vscode.WebviewView;
    private poll?: NodeJS.Timeout;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext, private readonly controller: AppiumController) {
        this.subscriptions.push(controller.onDidChange(state => this.post(state)));
    }

    resolveWebviewView(view: vscode.WebviewView) {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
        view.webview.html = webviewHtml(view.webview, this.context.extensionUri, {
            title: 'TestFly Appium',
            styles: ['inspector.css', 'sidebar.css'],
            scripts: ['sidebar.js'],
            body: fs.readFileSync(path.join(this.context.extensionPath, 'media', 'sidebar-body.html'), 'utf8'),
        });
        view.webview.onDidReceiveMessage(m => this.handle(m as Inbound), undefined, this.subscriptions);
        view.onDidChangeVisibility(() => this.watch(view.visible), undefined, this.subscriptions);
        view.onDidDispose(() => this.watch(false), undefined, this.subscriptions);
        this.watch(view.visible);
    }

    /** While the view is visible: ask /status now and then, so that a server started or stopped elsewhere shows up. */
    private watch(visible: boolean) {
        clearInterval(this.poll);
        this.poll = undefined;
        if (visible) {
            this.poll = setInterval(() => {
                void this.controller.checkServer();
                void this.controller.refreshPorts();
            }, STATUS_POLL_MS);
        }
    }

    private post(state: ControllerState) {
        void this.view?.webview.postMessage({ type: 'state', state, url: this.controller.serverUrl });
    }

    private async handle(m: Inbound) {
        switch (m.type) {
            case 'ready': {
                this.post(this.controller.current);
                const info = await this.controller.checkServer();
                const autoStart = vscode.workspace.getConfiguration(SECTION).get('appium.autoStart', false);
                await Promise.all([
                    info.state === 'stopped' && autoStart ? this.controller.start() : Promise.resolve(),
                    this.controller.current.drivers ? Promise.resolve() : this.controller.refreshAppium(),
                    this.controller.refreshDevices(),
                    this.controller.refreshPorts(),
                ]);
                return;
            }
            case 'start':
                return this.controller.start();
            case 'stop':
                return this.controller.stop();
            case 'restart':
                return this.controller.restart();
            case 'log':
                return this.controller.output.show(true);
            case 'settings':
                return vscode.commands.executeCommand('workbench.action.openSettings', `@ext:hakanngul.testfly-appium-inspector`);
            case 'stopPort':
                return this.controller.stopPort(m.pid);
            case 'reloadPorts':
                return this.controller.refreshPorts();
            case 'reloadDevices':
                return this.controller.refreshDevices();
            case 'reloadDrivers':
                return this.controller.refreshAppium();
            case 'boot':
                return this.controller.boot(m.id);
            case 'inspect':
                return InspectorPanel.show(this.context, this.controller, m.id);
            case 'copy':
                await vscode.env.clipboard.writeText(m.text);
                vscode.window.setStatusBarMessage(`$(check) Copied ${m.label}`, 2500);
                return;
        }
    }

    dispose() {
        clearInterval(this.poll);
        this.subscriptions.forEach(s => s.dispose());
    }
}
