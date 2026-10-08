// O botão "Rodar testes de caos": a extensão roda o pipeline inteiro (topologia → hipóteses →
// testes gerados → Vitest do projeto → portão) pela CLI empacotada (dist/shieldepy-cli.mjs), num
// processo à parte, com progresso e cancelamento. O resultado (.shieldepy/chaos-results.json) vira
// erro na Lista de erros e no Problems, na linha da operação atingida, e o mapa abre com ele.
// Também publica um resultado que já esteja no disco (rodado pela CLI ou pelo CI).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ChaosResults } from '@shieldepy/agent/chaos';
import type { FindingsManager } from '../analysis/FindingsManager';
import { isPathAllowed } from '../workspace/files';
import { chaosToFindings } from './chaosFindings';

const CONFIG_GLOB = '**/shieldepy.chaos.config.ts';
const RESULTS_GLOB = '**/.shieldepy/chaos-results.json';
const EXCLUDE = '**/{node_modules,dist,out,.git}/**';

export interface ChaosRunSummary {
  projectDir: string;
  exitCode: number | null;
  failed: number;
  passed: number;
  invalid: number;
}

export class ChaosController implements vscode.Disposable {
  /** Arquivos com achado de caos publicados, por projeto (para limpar quando o resultado muda). */
  private readonly published = new Map<string, Set<string>>();
  private readonly watcher = vscode.workspace.createFileSystemWatcher(RESULTS_GLOB);
  private running: ChildProcess | undefined;
  private readonly runningEmitter = new vscode.EventEmitter<boolean>();
  /** Começou/terminou uma rodada (o botão do painel fica desabilitado enquanto roda). */
  readonly onDidChangeRunning = this.runningEmitter.event;

  get isRunning(): boolean {
    return !!this.running;
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly findings: FindingsManager,
    private readonly output: vscode.OutputChannel,
    private readonly showMap: () => Promise<void>
  ) {
    const load = (uri: vscode.Uri) => void this.loadResults(uri);
    this.watcher.onDidCreate(load);
    this.watcher.onDidChange(load);
    this.watcher.onDidDelete((uri) => this.clearProject(path.dirname(path.dirname(uri.fsPath))));
  }

  /** Publica os resultados que já estão no disco (chamado depois do login e da indexação). */
  async loadExisting(): Promise<void> {
    for (const uri of await vscode.workspace.findFiles(RESULTS_GLOB, EXCLUDE, 20)) await this.loadResults(uri);
  }

  private async loadResults(uri: vscode.Uri): Promise<ChaosResults | undefined> {
    const projectDir = path.dirname(path.dirname(uri.fsPath));
    let results: ChaosResults;
    try {
      results = JSON.parse(await readFile(uri.fsPath, 'utf8')) as ChaosResults;
    } catch {
      return undefined; // ainda sendo gravado, ou apagado
    }
    const byFile = new Map<string, ReturnType<typeof chaosToFindings>>();
    for (const f of chaosToFindings(results, projectDir)) {
      if (!isPathAllowed(f.file)) continue;
      byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
    }
    for (const file of this.published.get(projectDir) ?? []) if (!byFile.has(file)) this.findings.clear(file, 'caos');
    for (const [file, list] of byFile) this.findings.set(file, 'caos', list);
    this.published.set(projectDir, new Set(byFile.keys()));
    return results;
  }

  private clearProject(projectDir: string): void {
    for (const file of this.published.get(projectDir) ?? []) this.findings.clear(file, 'caos');
    this.published.delete(projectDir);
  }

  /** O comando: escolhe o projeto (o que tem shieldepy.chaos.config.ts), roda e mostra o resultado. */
  async run(): Promise<ChaosRunSummary | undefined> {
    if (this.running) {
      void vscode.window.showInformationMessage('ShielDepy: os testes de caos já estão rodando (veja a notificação de progresso).');
      return undefined;
    }
    const configs = await vscode.workspace.findFiles(CONFIG_GLOB, EXCLUDE, 20);
    if (configs.length === 0) {
      const pick = await vscode.window.showWarningMessage(
        'ShielDepy: nenhum shieldepy.chaos.config.ts neste workspace. É ele que diz como subir o app, zerar o estado e o que nunca pode acontecer.',
        'Como criar'
      );
      if (pick) void vscode.env.openExternal(vscode.Uri.parse('https://github.com/victorcmrg/ShielDepyExtension/blob/main/shieldepy_p1/docs/chaos-ci.md'));
      return undefined;
    }
    const dirs = configs.map((u) => path.dirname(u.fsPath)).sort();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const picked =
      dirs.length === 1
        ? dirs[0]!
        : (await vscode.window.showQuickPick(dirs.map((d) => ({ label: path.relative(root, d) || '.', description: d, dir: d })), { title: 'ShielDepy: em qual projeto rodar os testes de caos?' }))?.dir;
    if (!picked) return undefined;
    // O caminho como está no disco: o VS Code entrega "c:\..." (drive minúsculo) no Windows, e o Node
    // resolve o node_modules com "C:\...". Com os dois, o Vitest carrega duas cópias de si mesmo e
    // nenhum teste roda ("Vitest failed to find the current suite").
    const projectDir = canonical(picked);

    const cli = vscode.Uri.joinPath(this.extensionUri, 'dist', 'shieldepy-cli.mjs').fsPath;
    const runtime = nodeRuntime();
    const args = [cli, 'chaos', projectDir, '--offline'];
    this.output.show(true);
    this.output.appendLine(`\n▶ testes de caos em ${projectDir} (${new Date().toLocaleTimeString()})`);
    this.output.appendLine(`  ${runtime.label} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

    const exitCode = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'ShielDepy: testes de caos', cancellable: true },
      (progress, token) =>
        new Promise<number | null>((resolve) => {
          progress.report({ message: 'lendo o código e montando a topologia...' });
          const child = spawn(runtime.cmd, args, { cwd: projectDir, env: { ...process.env, ...runtime.env, FORCE_COLOR: '0' }, windowsHide: true });
          this.running = child;
          this.runningEmitter.fire(true);
          let buffer = '';
          const onData = (chunk: Buffer) => {
            buffer += chunk.toString('utf8');
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              this.output.appendLine(line);
              const stage = stageOf(line);
              if (stage) progress.report({ message: stage });
            }
          };
          child.stdout?.on('data', onData);
          child.stderr?.on('data', onData);
          token.onCancellationRequested(() => {
            this.output.appendLine('■ cancelado');
            killTree(child);
          });
          child.on('error', (err) => {
            this.output.appendLine(`erro ao iniciar: ${err.message}`);
            this.running = undefined;
            this.runningEmitter.fire(false);
            resolve(2);
          });
          child.on('close', (code) => {
            if (buffer) this.output.appendLine(buffer);
            this.running = undefined;
            this.runningEmitter.fire(false);
            resolve(code);
          });
        })
    );

    // lido pelo caminho do VS Code (o mesmo do observador de arquivos): os achados ficam numa entrada só por arquivo
    const results = await this.loadResults(vscode.Uri.file(path.join(picked, '.shieldepy', 'chaos-results.json')));
    const count = (s: string) => results?.outcomes.filter((o) => o.status === s).length ?? 0;
    const summary: ChaosRunSummary = { projectDir, exitCode, failed: count('failed'), passed: count('passed'), invalid: count('invalid') };
    this.output.appendLine(`■ fim: ${summary.failed} achado(s), ${summary.passed} aguentou(aram), ${summary.invalid} inválido(s) (exit ${exitCode})`);

    if (exitCode === 2 || !results?.ran) {
      void vscode.window.showErrorMessage('ShielDepy: os testes de caos não rodaram (erro de ambiente). Veja o log na Saída → ShielDepy.', 'Ver log').then((p) => p && this.output.show());
      return summary;
    }
    // o grafo final, com o que quebrou marcado (a rota em vermelho e a operação atingida)
    await this.showMap();
    const text =
      summary.failed > 0
        ? `ShielDepy: ${summary.failed} falha(s) provada(s) pelos testes de caos. Elas estão na Lista de erros e no mapa.`
        : `ShielDepy: o código aguentou todas as falhas injetadas (${summary.passed} teste(s)${summary.invalid ? `, ${summary.invalid} inválido(s)` : ''}).`;
    const show = summary.failed > 0 ? vscode.window.showErrorMessage : vscode.window.showInformationMessage;
    void show(text, 'Ver erros', 'Ver log').then((p) => {
      if (p === 'Ver erros') void vscode.commands.executeCommand('workbench.actions.view.problems');
      if (p === 'Ver log') this.output.show();
    });
    return summary;
  }

  dispose(): void {
    if (this.running) killTree(this.running);
    this.watcher.dispose();
    this.runningEmitter.dispose();
  }
}

function canonical(dir: string): string {
  try {
    return realpathSync.native(dir);
  } catch {
    return dir;
  }
}

/** O que dizer na notificação de progresso, a partir da saída da CLI. */
function stageOf(line: string): string | undefined {
  if (line.includes('hipótese(s)')) return 'hipóteses de falha prontas; gerando os testes...';
  if (line.includes('teste(s) de caos em')) return 'testes gerados';
  if (line.includes('rodando') && line.includes('teste(s) de caos')) return 'rodando os testes com o Vitest do projeto (controle + caos)...';
  if (line.includes('resultado:')) return line.replace(/^.*resultado:\s*/, '');
  return undefined;
}

/**
 * Quem roda a CLI: o Node do sistema (o mesmo que roda os testes do projeto); sem ele, o próprio
 * VS Code como Node (ELECTRON_RUN_AS_NODE), que é o que o comando `code` faz.
 */
function nodeRuntime(): { cmd: string; env: Record<string, string>; label: string } {
  const probe = spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) return { cmd: 'node', env: {}, label: `node ${probe.stdout.trim()}` };
  return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'Node do VS Code' };
}

/** No Windows, matar só o pai deixa o Vitest e os workers dele rodando. */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}
