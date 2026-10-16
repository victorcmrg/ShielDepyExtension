// O resultado do caos no código: cada `.shieldepy/chaos-results.json` do workspace (gravado pelo
// "Testar Caos", pela CLI ou pelo CI) vira erro na Lista de erros e no Problems, na linha da operação
// atingida. O observador de arquivos mantém tudo em dia: rodou de novo, os achados mudam; apagou, somem.
// Quem roda o caos é o `ChaosCommand`.
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ChaosResults } from '@shieldepy/agent/chaos';
import type { FindingsManager } from '../analysis/FindingsManager';
import { chaosToFindings } from './chaosFindings';

const RESULTS_GLOB = '**/.shieldepy/chaos-results.json';
const EXCLUDE = '**/{node_modules,dist,out,.git}/**';

export class ChaosController implements vscode.Disposable {
  /** Arquivos com achado de caos publicados, por projeto (para limpar quando o resultado muda). */
  private readonly published = new Map<string, Set<string>>();
  private readonly watcher = vscode.workspace.createFileSystemWatcher(RESULTS_GLOB);

  constructor(private readonly findings: FindingsManager) {
    const load = (uri: vscode.Uri) => void this.loadResults(uri);
    this.watcher.onDidCreate(load);
    this.watcher.onDidChange(load);
    this.watcher.onDidDelete((uri) => this.clearProject(path.dirname(path.dirname(uri.fsPath))));
  }

  /** Publica os resultados que já estão no disco (chamado depois da indexação inicial). */
  async loadExisting(): Promise<void> {
    for (const uri of await vscode.workspace.findFiles(RESULTS_GLOB, EXCLUDE, 20)) await this.loadResults(uri);
  }

  /** Lê um resultado e publica os achados (o caminho do VS Code, o mesmo do observador: uma entrada por arquivo). */
  async loadResults(uri: vscode.Uri): Promise<ChaosResults | undefined> {
    const projectDir = path.dirname(path.dirname(uri.fsPath));
    let results: ChaosResults;
    try {
      results = JSON.parse(await readFile(uri.fsPath, 'utf8')) as ChaosResults;
    } catch {
      return undefined; // ainda sendo gravado, ou apagado
    }
    const byFile = new Map<string, ReturnType<typeof chaosToFindings>>();
    for (const f of chaosToFindings(results, projectDir)) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
    for (const file of this.published.get(projectDir) ?? []) if (!byFile.has(file)) this.findings.clear(file, 'caos');
    for (const [file, list] of byFile) this.findings.set(file, 'caos', list);
    this.published.set(projectDir, new Set(byFile.keys()));
    return results;
  }

  private clearProject(projectDir: string): void {
    for (const file of this.published.get(projectDir) ?? []) this.findings.clear(file, 'caos');
    this.published.delete(projectDir);
  }

  dispose(): void {
    this.watcher.dispose();
  }
}
