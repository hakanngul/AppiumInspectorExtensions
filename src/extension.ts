import * as vscode from 'vscode';
import { AppiumController, SECTION } from './controller';
import { InspectorPanel } from './inspectorPanel';
import { SidebarProvider } from './sidebar';

let controller: AppiumController | undefined;

export function activate(context: vscode.ExtensionContext) {
    controller = new AppiumController();
    const sidebar = new SidebarProvider(context, controller);
    context.subscriptions.push(controller, sidebar);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar));
    const command = (name: string, run: (c: AppiumController) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(`${SECTION}.${name}`, () => controller && run(controller)));
    command('startServer', c => c.start());
    command('stopServer', c => c.stop());
    command('showServerLog', c => c.output.show(true));
    command('refreshDevices', c => c.refreshDevices());
    command('open', c => InspectorPanel.show(context, c));
}

/** Stops the Appium server this extension started; a server started elsewhere keeps running. */
export function deactivate() {
    InspectorPanel.disposeCurrent();
    controller?.dispose();
    controller = undefined;
}
