import * as vscode from 'vscode';

export interface WebviewPage {
    title: string;
    /** Files in media/. */
    styles: string[];
    scripts: string[];
    body: string;
}

/** A webview document with a strict CSP: only media/ styles, nonce'd media/ scripts and data: images. */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, page: WebviewPage): string {
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${page.styles.map(s => `<link href="${media(s)}" rel="stylesheet">`).join('\n')}
<title>${page.title}</title>
</head>
<body>
${page.body}
${page.scripts.map(s => `<script nonce="${nonce}" src="${media(s)}"></script>`).join('\n')}
</body>
</html>`;
}
