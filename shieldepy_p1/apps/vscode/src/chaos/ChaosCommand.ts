import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { attackSurface, buildSystemGraph, buildTopology, CHAOS_CONFIG_FILE, CHAOS_CONFIG_TODO, chaosConfigPending } from '@shieldepy/core';
import { CMD } from '../constants';
import type { AiService } from '../services/AiService';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import type { ChaosArgs, ChaosIo } from './run-chaos';

/** Onde a CLI grava o resultado (`CHAOS_RESULTS_FILE` do agent; importar o agent/chaos puxaria o LangGraph). */
const RESULTS_FILE = path.join('.shieldepy', 'chaos-results.json');
/** O relatório markdown desta execução (o mesmo do comentário do PR no CI). */
const REPORT_FILE = path.join('.shieldepy', 'chaos-report.md');
/** O que os testes gerados importam. O Vitest tem que estar na raiz do projeto (é ele que roda). */
const TEST_PACKAGES = ['vitest', 'supertest', 'msw'];
/** A base do "só o que mudou", na ordem de preferência. */
const BASE_REFS = ['origin/main', 'origin/master', 'main', 'master'];

export interface ChaosProject {
  root: string;
  /** Rotas sensíveis do projeto no mapa. */
  routes: number;
  hasContract: boolean;
}

export interface ChaosRunOptions {
  base?: string;
  offline: boolean;
}

/**
 * "ShielDepy: Testar Caos" (R3): o `shieldepy chaos` da CLI dentro do editor, com o caminho guiado.
 * 1. qual projeto (o que tem rotas sensíveis no mapa ou já tem contrato);
 * 2. sem contrato: oferece criar um a partir do mapa (`--init`) e abre o arquivo;
 * 3. contrato com pendências ou pacotes de teste faltando: diz o que falta e como resolver;
 * 4. escopo (o que mudou desde a main, como no CI, ou tudo) e quem propõe as hipóteses (motor ou IA);
 * 5. roda num terminal próprio; no fim, o resultado no mapa e o relatório.
 * O pipeline (LangGraph, Vitest) mora em `dist/chaos.js` e só é carregado aqui.
 */
export class ChaosCommand implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private running = false;

  constructor(
    private readonly extensionPath: string,
    private readonly model: WorkspaceModel,
    private readonly ai: AiService,
    private readonly log: (message: string) => void
  ) {}

  async run(): Promise<void> {
    if (this.running) {
      this.terminal?.show();
      void vscode.window.showInformationMessage('ShielDepy: o teste de caos já está rodando. Acompanhe no terminal "ShielDepy: caos".');
      return;
    }
    const project = await this.pickProject();
    if (!project) return;
    const { root } = project;
    const configPath = path.join(root, CHAOS_CONFIG_FILE);

    if (!project.hasContract) {
      const create = 'Criar o contrato';
      const choice = await vscode.window.showInformationMessage(
        `ShielDepy: para testar o caos em ${this.label(root)}, falta o contrato (${CHAOS_CONFIG_FILE}): como subir o app sem abrir porta, zerar o estado e uma requisição válida por rota. Ele sai do mapa já com as ${project.routes} rota(s) sensível(is) e as APIs; você completa só o que vier marcado.`,
        create
      );
      if (choice === create) await this.createContract(root);
      return;
    }

    const pending = chaosConfigPending(readFileSync(configPath, 'utf8'));
    if (pending > 0) {
      const open = 'Abrir o contrato';
      const anyway = 'Rodar mesmo assim';
      const choice = await vscode.window.showWarningMessage(
        `ShielDepy: o contrato de caos ainda tem ${pending} pendência(s) marcada(s) com ${CHAOS_CONFIG_TODO}. Sem elas, os testes caem como inválidos.`,
        open,
        anyway
      );
      if (choice === open) await vscode.window.showTextDocument(vscode.Uri.file(configPath));
      if (choice !== anyway) return;
    }

    const missing = this.missingPackages(root);
    if (missing.length > 0) {
      this.offerInstall(root, missing);
      return;
    }

    const options = await this.pickOptions(root);
    if (options) await this.execute(root, options);
  }

  /** Projetos onde dá para testar o caos: os que já têm contrato e os que têm rota sensível no mapa. */
  projects(): ChaosProject[] {
    const found = new Map<string, ChaosProject>();
    const add = (root: string, routes: number) => {
      const current = found.get(root);
      found.set(root, { root, routes: (current?.routes ?? 0) + routes, hasContract: existsSync(path.join(root, CHAOS_CONFIG_FILE)) });
    };
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const top = folder.uri.fsPath;
      const topology = buildTopology(this.model.graph, buildSystemGraph(this.model.graph, this.model.rules, top), top);
      const sensitive = new Set(attackSurface(topology).routes.map((r) => r.id));
      for (const route of topology.routes) {
        if (!sensitive.has(route.id)) continue;
        const root = packageRoot(path.join(top, route.file), top);
        if (root) add(root, 1);
      }
    }
    return [...found.values()].sort((a, b) => a.root.localeCompare(b.root));
  }

  /** Grava o contrato inicial a partir do mapa (o `shieldepy chaos --init` da CLI) e o abre. */
  async createContract(root: string): Promise<boolean> {
    const lines: string[] = [];
    const code = await this.invoke({ target: root, init: true }, { out: (l) => lines.push(l), err: (l) => lines.push(l), env: process.env });
    for (const l of lines) this.log(`[caos] ${l}`);
    if (code !== 0) {
      void vscode.window.showErrorMessage(`ShielDepy: não deu para criar o contrato. ${lines.join(' ')}`);
      return false;
    }
    const file = vscode.Uri.file(path.join(root, CHAOS_CONFIG_FILE));
    await vscode.window.showTextDocument(file);
    void vscode.window.showInformationMessage(
      `ShielDepy: contrato criado. Complete as linhas marcadas com ${CHAOS_CONFIG_TODO} (subir o app, zerar o estado, as respostas das APIs e os corpos) e rode "Testar Caos" de novo.`
    );
    return true;
  }

  /** Pacotes que os testes gerados precisam e o projeto não tem instalados. */
  missingPackages(root: string): string[] {
    return TEST_PACKAGES.filter((pkg) =>
      pkg === 'vitest' ? !existsSync(path.join(root, 'node_modules', 'vitest', 'vitest.mjs')) : !installedFrom(root, pkg)
    );
  }

  /** Roda o caos (já com contrato e pacotes) num terminal próprio e devolve o código de saída. */
  async execute(root: string, options: ChaosRunOptions): Promise<number | undefined> {
    this.running = true;
    try {
      const write = await this.openTerminal();
      const where = options.base ? `só o que mudou desde ${options.base}` : 'todas as rotas sensíveis';
      write(`ShielDepy: testando o caos em ${this.label(root)} (${where}, ${options.offline ? 'motor offline, grátis' : 'hipóteses da IA'})\n`);
      const env = options.offline ? process.env : await this.ai.cliEnv();
      const code = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'ShielDepy: testando o caos…' }, () =>
        this.invoke({ target: root, base: options.base, offline: options.offline, report: path.join(root, REPORT_FILE) }, { out: write, err: write, env })
      );
      write(`\n(terminou com código ${code}: ${code === 0 ? 'nada barrou' : code === 1 ? 'achados provados' : 'o ambiente não deixou provar'})`);
      this.announce(root, code);
      return code;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[caos] falhou: ${err instanceof Error ? (err.stack ?? message) : message}`);
      void vscode.window.showErrorMessage(`ShielDepy: o teste de caos falhou: ${message}`);
      return undefined;
    } finally {
      this.running = false;
    }
  }

  /** Carrega o bundle do caos sob demanda e roda o comando da CLI. */
  private invoke(args: Omit<ChaosArgs, 'json' | 'noRun' | 'offline'> & { offline?: boolean; noRun?: boolean }, io: ChaosIo): Promise<number> {
    // Caminho calculado: o esbuild não embute este require (o bundle do caos é outro arquivo).
    const bundle = path.join(this.extensionPath, 'dist', 'chaos.js');
    const { runChaos } = require(bundle) as typeof import('./run-chaos');
    return runChaos({ json: false, noRun: false, offline: true, ...args, wasmDir: path.join(this.extensionPath, 'wasm') }, io);
  }

  private async pickProject(): Promise<ChaosProject | undefined> {
    if (!vscode.workspace.workspaceFolders?.length) {
      void vscode.window.showInformationMessage('ShielDepy: abra a pasta do projeto para testar o caos.');
      return undefined;
    }
    const projects = this.projects();
    if (projects.length === 0) {
      const map = 'Ver o mapa';
      const choice = await vscode.window.showInformationMessage(
        'ShielDepy: nenhuma rota sensível no mapa. O caos testa rotas Express que gravam no banco (pg, Prisma) ou chamam APIs externas (fetch, axios).',
        map
      );
      if (choice === map) void vscode.commands.executeCommand(CMD.showMap);
      return undefined;
    }
    if (projects.length === 1) return projects[0];
    const pick = await vscode.window.showQuickPick(
      projects.map((p) => ({
        label: this.label(p.root),
        description: `${p.routes} rota(s) sensível(is)`,
        detail: p.hasContract ? 'contrato de caos pronto' : 'sem contrato ainda (o ShielDepy cria a partir do mapa)',
        project: p,
      })),
      { title: 'ShielDepy: testar o caos em qual projeto?' }
    );
    return pick?.project;
  }

  private async pickOptions(root: string): Promise<ChaosRunOptions | undefined> {
    const base = await firstRef(root);
    const scopes = [
      ...(base ? [{ label: `$(git-pull-request) Só o que mudou desde ${base}`, description: 'as rotas sensíveis que esta branch tocou, como no CI', base }] : []),
      { label: '$(list-flat) Todas as rotas sensíveis', description: 'o projeto inteiro', base: undefined as string | undefined },
    ];
    const scope = scopes.length === 1 ? scopes[0] : await vscode.window.showQuickPick(scopes, { title: 'ShielDepy: testar o caos em…' });
    if (!scope) return undefined;

    if (!(await this.ai.provider())) return { base: scope.base, offline: true };
    const engines = [
      { label: '$(zap) Motor (grátis)', description: 'hipóteses do catálogo, sem chamar a IA', offline: true },
      { label: '$(sparkle) Com IA', description: 'a IA propõe as hipóteses e explica o resultado; usa a sua chave (o custo sai no fim)', offline: false },
    ];
    const engine = await vscode.window.showQuickPick(engines, { title: 'ShielDepy: quem propõe as hipóteses?' });
    return engine && { base: scope.base, offline: engine.offline };
  }

  private offerInstall(root: string, missing: string[]): void {
    const noModules = !existsSync(path.join(root, 'node_modules'));
    const manager = existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
    const command = noModules ? `${manager} install` : `${manager} ${manager === 'npm' ? 'install' : 'add'} -D ${missing.join(' ')}`;
    const install = 'Instalar no terminal';
    const why = noModules ? 'as dependências do projeto não estão instaladas' : `faltam pacotes que os testes de caos usam: ${missing.join(', ')}`;
    void vscode.window.showWarningMessage(`ShielDepy: ${why}. Comando: ${command}`, install).then((choice) => {
      if (choice !== install) return;
      const terminal = vscode.window.createTerminal({ name: 'ShielDepy: dependências', cwd: root });
      terminal.show();
      terminal.sendText(command);
      void vscode.window.showInformationMessage('ShielDepy: quando a instalação terminar, rode "Testar Caos" de novo.');
    });
  }

  /** Terminal "ShielDepy: caos" (pseudoterminal): a mesma saída da CLI, ao vivo. */
  private async openTerminal(): Promise<(text: string) => void> {
    this.terminal?.dispose();
    const emitter = new vscode.EventEmitter<string>();
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => (opened = resolve));
    this.terminal = vscode.window.createTerminal({
      name: 'ShielDepy: caos',
      iconPath: new vscode.ThemeIcon('beaker'),
      pty: { onDidWrite: emitter.event, open: () => opened(), close: () => emitter.dispose() },
    });
    this.terminal.show(true);
    await ready;
    return (text) => emitter.fire(`${text}\n`.replace(/\r?\n/g, '\r\n'));
  }

  /** O resumo no fim, com os atalhos para o mapa (o resultado aparece por cima) e o relatório. */
  private announce(root: string, code: number): void {
    const map = 'Ver no mapa';
    const report = 'Abrir relatório';
    const terminal = 'Ver terminal';
    const results = readResults(root);
    const tested = results?.outcomes.length ?? 0;
    const message =
      code === 1
        ? vscode.window.showWarningMessage(`ShielDepy: o caos provou ${results?.hits ?? 'algum'} problema(s) em ${this.label(root)}.`, map, report)
        : code === 0
          ? vscode.window.showInformationMessage(
              tested > 0 ? `ShielDepy: ${tested} teste(s) de caos, nenhum problema provado.` : 'ShielDepy: nenhuma rota sensível neste escopo; nada a testar.',
              map,
              report
            )
          : vscode.window.showErrorMessage('ShielDepy: o ambiente não deixou provar nada (os controles falharam ou o Vitest não rodou). Veja o terminal.', terminal, report);
    void message.then((choice) => {
      if (choice === map) void vscode.commands.executeCommand(CMD.showMap);
      else if (choice === report) void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(root, REPORT_FILE)));
      else if (choice === terminal) this.terminal?.show();
    });
  }

  private label(root: string): string {
    const relative = vscode.workspace.asRelativePath(root, true);
    return relative === root ? path.basename(root) : relative;
  }

  dispose(): void {
    this.terminal?.dispose();
  }
}

/** A pasta com `package.json` mais perto do arquivo, sem subir além de `top`. */
function packageRoot(file: string, top: string): string | undefined {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    if (path.relative(top, dir) === '' || path.dirname(dir) === dir) return undefined;
  }
}

/** O pacote resolve a partir do projeto (inclusive içado num monorepo)? */
function installedFrom(root: string, pkg: string): boolean {
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'node_modules', pkg, 'package.json'))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/** O primeiro ref de `BASE_REFS` que existe no repositório (nenhum = não é git, ou sem main). */
async function firstRef(root: string): Promise<string | undefined> {
  for (const ref of BASE_REFS) {
    const ok = await new Promise<boolean>((resolve) =>
      execFile('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root }, (err) => resolve(!err))
    );
    if (ok) return ref;
  }
  return undefined;
}

function readResults(root: string): { hits: number; outcomes: unknown[] } | undefined {
  try {
    const data = JSON.parse(readFileSync(path.join(root, RESULTS_FILE), 'utf8')) as { hits?: number; outcomes?: unknown[] };
    return { hits: data.hits ?? 0, outcomes: Array.isArray(data.outcomes) ? data.outcomes : [] };
  } catch {
    return undefined;
  }
}
