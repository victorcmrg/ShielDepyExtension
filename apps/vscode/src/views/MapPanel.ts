import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  affectedRoutes,
  buildSystemGraph,
  buildTopology,
  CodeGraph,
  diffSystemGraphs,
  indexFiles,
  listSourceFiles,
  silentHost,
  withBaseCheckout,
  type SystemGraph,
  type TopologyGraph,
} from '@shieldepy/core';
import { renderGraphHtml, VIEWER_LIBRARIES, type ViewerChaos, type ViewerOverlay } from '@shieldepy/viewer';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import { openLocation } from './ConflictBalloon';

/** O arquivo que o `shieldepy chaos` grava em cada projeto (`CHAOS_RESULTS_FILE` do agent). */
export const CHAOS_RESULTS_GLOB = '**/.shieldepy/chaos-results.json';

/**
 * Painel "Mapa do sistema": o mesmo visualizador da CLI (`shieldepy graph --html`), dentro do
 * editor. Mostra o que o grafo provou, a cobertura, os pontos fracos e as rotas com as operações
 * de I/O (topologia, E2); "Abrir código" leva ao arquivo/linha. Reabrir o comando reconstrói o
 * mapa com o estado atual do workspace.
 *
 * V2: por cima do mapa, o resultado do último `shieldepy chaos` (lido de
 * `.shieldepy/chaos-results.json`, atualizado quando o arquivo muda) e o diff contra uma branch
 * ("Comparar mapa com uma branch").
 */
export class MapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private root = '';
  /** Pasta do projeto de onde veio o resultado do caos (o "Abrir teste" resolve a partir dela). */
  private chaosProject = '';
  private diffOverlay: ViewerOverlay['diff'];
  private readonly watcher: vscode.FileSystemWatcher;
  /** Último mapa renderizado (o E2E confere por aqui). */
  last: SystemGraph | undefined;
  lastTopology: TopologyGraph | undefined;
  lastOverlay: ViewerOverlay | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: WorkspaceModel,
    private readonly wasmDir: string
  ) {
    // a CLI gravou um resultado novo: o painel aberto se atualiza sozinho
    this.watcher = vscode.workspace.createFileSystemWatcher(CHAOS_RESULTS_GLOB);
    const refresh = () => {
      if (this.panel) void this.show(false);
    };
    this.watcher.onDidCreate(refresh);
    this.watcher.onDidChange(refresh);
    this.watcher.onDidDelete(refresh);
  }

  async show(reveal = true): Promise<void> {
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
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.diffOverlay = undefined;
      });
      this.panel.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg));
    }

    const webview = this.panel.webview;
    this.last = buildSystemGraph(this.model.graph, this.model.rules, this.root);
    this.lastTopology = buildTopology(this.model.graph, this.last, this.root);
    const chaos = await this.loadChaos();
    this.lastOverlay = { ...(chaos && { chaos }), ...(this.diffOverlay && { diff: this.diffOverlay }) };
    webview.html = renderGraphHtml(
      this.last,
      folder.name,
      {
        kind: 'webview',
        nonce: randomBytes(16).toString('base64'),
        cspSource: webview.cspSource,
        libraryUris: VIEWER_LIBRARIES.map((lib) => webview.asWebviewUri(vscode.Uri.joinPath(vendor, lib.file)).toString()),
      },
      this.lastTopology,
      this.lastOverlay
    );
    if (reveal) this.panel.reveal();
  }

  /**
   * O resultado do caos do workspace: o da raiz, se houver; senão, o mais recente (num workspace
   * com vários projetos, o painel diz de qual é). Desatualizado = algum arquivo do projeto que está
   * no mapa foi alterado depois do resultado.
   */
  private async loadChaos(): Promise<ViewerChaos | undefined> {
    const found = await vscode.workspace.findFiles(CHAOS_RESULTS_GLOB, '**/node_modules/**', 20);
    const candidates = found
      .map((uri) => {
        try {
          return { file: uri.fsPath, mtime: statSync(uri.fsPath).mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((c): c is { file: string; mtime: number } => !!c)
      .sort((a, b) => b.mtime - a.mtime);
    const atRoot = candidates.find((c) => path.dirname(path.dirname(c.file)) === this.root);
    const pick = atRoot ?? candidates[0];
    if (!pick) return undefined;
    let data: ViewerChaos;
    try {
      data = JSON.parse(readFileSync(pick.file, 'utf8')) as ViewerChaos;
    } catch {
      return undefined;
    }
    if (!data || (data as { version?: unknown }).version !== 1 || !Array.isArray(data.outcomes)) return undefined;
    this.chaosProject = path.dirname(path.dirname(pick.file));
    return { ...data, stale: this.newestSourceIn(this.chaosProject) > pick.mtime };
  }

  /** Data da última alteração em disco dos arquivos do mapa que ficam dentro da pasta. */
  private newestSourceIn(dir: string): number {
    let newest = 0;
    for (const n of this.model.graph.toSnapshot().nodes) {
      const a = n.attributes as { kind?: string; path?: string };
      if (a.kind !== 'file' || !a.path || path.relative(dir, a.path).startsWith('..')) continue;
      try {
        newest = Math.max(newest, statSync(a.path).mtimeMs);
      } catch {
        // apagado entre a indexação e agora: não conta
      }
    }
    return newest;
  }

  /**
   * "Comparar mapa com uma branch": o mapa do workspace no merge-base com `ref` (num git worktree
   * temporário, indexado à parte) contra o mapa atual. O resultado fica no painel até ele fechar.
   */
  async compare(ref: string): Promise<ViewerOverlay['diff']> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    const root = folder.uri.fsPath;
    const head = buildSystemGraph(this.model.graph, this.model.rules, root);
    const headTopology = buildTopology(this.model.graph, head, root);
    this.diffOverlay = await withBaseCheckout(root, ref, async (baseDir, info) => {
      const graph = await CodeGraph.create(this.wasmDir, silentHost);
      await indexFiles(graph, await listSourceFiles(baseDir, Number.MAX_SAFE_INTEGER), silentHost);
      const before = buildSystemGraph(graph, [], baseDir);
      const diff = diffSystemGraphs(before, head);
      const routes = affectedRoutes(buildTopology(graph, before, baseDir), headTopology, diff, info.changedFiles);
      return { base: ref, commit: info.commit, diff, routes };
    });
    await this.show();
    return this.diffOverlay;
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const { type, file, line } = msg as { type?: unknown; file?: unknown; line?: unknown };
    if (typeof file !== 'string') return;
    // ids do mapa são relativos à raiz; o teste de caos, ao projeto do resultado. Nunca sai da raiz
    // do workspace (o webview não escolhe caminho arbitrário).
    const base = type === 'openTest' ? this.chaosProject || this.root : type === 'open' ? this.root : undefined;
    if (!base) return;
    const full = path.resolve(base, file);
    if (path.relative(this.root, full).startsWith('..')) return;
    void openLocation(full, Number(line) || 0);
  }

  dispose(): void {
    this.watcher.dispose();
    this.panel?.dispose();
  }
}
