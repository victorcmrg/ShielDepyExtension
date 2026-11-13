import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
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
import { renderGraphHtml, VIEWER_LIBRARIES, type ViewerChaos, type ViewerLayout, type ViewerOverlay } from '@shieldepy/viewer';
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
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Posições que o webview já calculou (por combinação de filtros) e o tema do botão sol/lua.
   * As posições também vão para um arquivo na pasta temporária do sistema, um por projeto: reabrir
   * o mapa, mesmo depois de fechar o VS Code, não roda o layout de novo (é a parte demorada).
   */
  private layout: ViewerLayout = {};
  private layoutRoot = '';
  private layoutTimer: ReturnType<typeof setTimeout> | undefined;
  private theme: 'light' | 'dark' | undefined;
  /** Último mapa renderizado (o E2E confere por aqui). */
  last: SystemGraph | undefined;
  lastTopology: TopologyGraph | undefined;
  lastOverlay: ViewerOverlay | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly model: WorkspaceModel,
    private readonly wasmDir: string
  ) {
    // a CLI gravou um resultado novo: o painel aberto se atualiza sozinho (uma vez por rajada:
    // gravar o arquivo costuma disparar criar e mudar juntos)
    this.watcher = vscode.workspace.createFileSystemWatcher(CHAOS_RESULTS_GLOB);
    const refresh = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        if (this.panel) void this.show(false);
      }, 250);
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
    if (this.layoutRoot !== this.root) {
      this.layoutRoot = this.root;
      this.layout = readLayout(this.layoutFile());
    }
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
        layout: this.layout,
        ...(this.theme && { theme: this.theme }),
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

  /**
   * Data da última alteração em disco dos arquivos do mapa que ficam dentro da pasta. Lê os
   * arquivos do mapa já montado (`this.last`), em vez de serializar o grafo inteiro a cada abertura.
   */
  private newestSourceIn(dir: string): number {
    let newest = 0;
    for (const n of this.last?.nodes ?? []) {
      if (n.kind !== 'file' || n.external) continue;
      const file = path.resolve(this.root, n.id);
      if (path.relative(dir, file).startsWith('..')) continue;
      try {
        newest = Math.max(newest, statSync(file).mtimeMs);
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
    if (type === 'layout') return this.keepLayout(msg as { key?: unknown; positions?: unknown });
    if (type === 'theme') {
      const theme = (msg as { theme?: unknown }).theme;
      this.theme = theme === 'light' || theme === 'dark' ? theme : undefined;
      return;
    }
    if (typeof file !== 'string') return;
    // ids do mapa são relativos à raiz; o teste de caos, ao projeto do resultado. Nunca sai da raiz
    // do workspace (o webview não escolhe caminho arbitrário).
    const base = type === 'openTest' ? this.chaosProject || this.root : type === 'open' ? this.root : undefined;
    if (!base) return;
    const full = path.resolve(base, file);
    if (path.relative(this.root, full).startsWith('..')) return;
    void openLocation(full, Number(line) || 0);
  }

  /** Guarda as posições que o webview calculou (só números; no máximo 6 combinações de filtros). */
  private keepLayout({ key, positions }: { key?: unknown; positions?: unknown }): void {
    const clean = cleanPositions(positions);
    if (typeof key !== 'string' || key.length > 1000 || !clean) return;
    delete this.layout[key];
    this.layout[key] = clean;
    const keys = Object.keys(this.layout);
    for (const old of keys.slice(0, Math.max(0, keys.length - 6))) delete this.layout[old];
    clearTimeout(this.layoutTimer);
    const file = this.layoutFile();
    const data = JSON.stringify(this.layout);
    this.layoutTimer = setTimeout(() => {
      // é só um cache: se não gravar, a próxima abertura calcula de novo
      void mkdir(path.dirname(file), { recursive: true })
        .then(() => writeFile(file, data, 'utf8'))
        .catch(() => undefined);
    }, 500);
  }

  private layoutFile(): string {
    return path.join(os.tmpdir(), 'shieldepy-map', createHash('sha1').update(this.root).digest('hex').slice(0, 16) + '.json');
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.layoutTimer);
    this.watcher.dispose();
    this.panel?.dispose();
  }
}

/** Posições `{ id: [x, y] }` vindas do webview ou do disco: só números entram. */
function cleanPositions(positions: unknown): Record<string, [number, number]> | undefined {
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) return undefined;
  const clean = Object.create(null) as Record<string, [number, number]>;
  for (const [id, p] of Object.entries(positions as Record<string, unknown>)) {
    if (Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) clean[id] = [p[0] as number, p[1] as number];
  }
  return clean;
}

/** O cache de posições gravado numa abertura anterior; sem arquivo (ou corrompido), vazio. */
function readLayout(file: string): ViewerLayout {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const layout: ViewerLayout = {};
    if (!raw || typeof raw !== 'object') return layout;
    for (const [key, positions] of Object.entries(raw as Record<string, unknown>).slice(-6)) {
      const clean = cleanPositions(positions);
      if (clean) layout[key] = clean;
    }
    return layout;
  } catch {
    return {};
  }
}
