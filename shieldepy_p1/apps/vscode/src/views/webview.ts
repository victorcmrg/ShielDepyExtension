import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/**
 * Casca HTML comum dos webviews com Content-Security-Policy (item 3.5): só scripts com o nonce
 * desta renderização e só CSS/JS vindos de `media/webview/`. Um texto de achado ou resposta de IA
 * que contenha `<script>` não executa, mesmo que algum trecho escape do `textContent`.
 */
export function renderWebview(options: {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /** Nome-base dos assets em media/webview (`chat` → chat.css + chat.js). */
  asset: string;
  body: string;
  /** Estado inicial serializado pro script (lido de `window.__INITIAL__`). */
  initial?: unknown;
}): string {
  const { webview, extensionUri, asset, body } = options;
  const nonce = randomBytes(16).toString('base64');
  const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview', file));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  // JSON dentro de <script>: escapa `<` pra um "</script>" nos dados não fechar a tag.
  const initial = JSON.stringify(options.initial ?? {}).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${media('common.css')}" />
<link rel="stylesheet" href="${media(`${asset}.css`)}" />
</head>
<body>
${body}
<script nonce="${nonce}">window.__INITIAL__ = ${initial};</script>
<script nonce="${nonce}" src="${media(`${asset}.js`)}"></script>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
