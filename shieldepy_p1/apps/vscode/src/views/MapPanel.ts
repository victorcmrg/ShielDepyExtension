import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildSystemGraph, buildTopology, type SystemGraph, type TopologyGraph } from '@shieldepy/core';
import { renderGraphHtml, VIEWER_LIBRARIES } from '@shieldepy/viewer';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import { openLocation } from './ConflictBalloon';

/**
 * Painel "Mapa do sistema": o mesmo visualizador da CLI (`shieldepy graph --html`), dentro do
 * editor. Mostra o que o grafo provou, a cobertura, os pontos fracos e as rotas com as operações
 * de I/O (topologia, E2); "Abrir código" leva ao arquivo/linha. Reabrir o comando reconstrói o
 * mapa com o estado atual do workspace.
 */
export class MapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private root = '';
  /** Último mapa renderizado (o E2E confere por aqui). */
  last: SystemGraph | undefined;
  lastTopology: TopologyGraph | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: WorkspaceModel
  ) {}

  show(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showInformationMessage('ShielDepy: abra uma pasta para ver o mapa do sistema.');
      return;
    }
    this.root = folder.uri.fsPath;
    const vendor = vscode.Uri.joinPath(this.extensionUri, 'media', 'vendor');

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('shieldepy.map', 'Mapa do sistema', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vendor],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg));
    }

    const webview = this.panel.webview;
    this.last = buildSystemGraph(this.model.graph, this.model.rules, this.root);
    this.lastTopology = buildTopology(this.model.graph, this.last, this.root);
    webview.html = renderGraphHtml(
      this.last,
      folder.name,
      {
        kind: 'webview',
        nonce: randomBytes(16).toString('base64'),
        cspSource: webview.cspSource,
        libraryUris: VIEWER_LIBRARIES.map((lib) => webview.asWebviewUri(vscode.Uri.joinPath(vendor, lib.file)).toString()),
      },
      this.lastTopology
    );
    this.panel.reveal();
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const { type, file, line } = msg as { type?: unknown; file?: unknown; line?: unknown };
    if (type !== 'open' || typeof file !== 'string') return;
    // ids do mapa são relativos à raiz; nunca sai dela (o webview não escolhe caminho arbitrário)
    const full = path.resolve(this.root, file);
    if (path.relative(this.root, full).startsWith('..')) return;
    void openLocation(full, Number(line) || 0);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
