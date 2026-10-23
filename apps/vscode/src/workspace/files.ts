import * as vscode from 'vscode';
import { config } from '../config';
import { EXCLUDE_GLOB, FILE_GLOB, GRAPH_LANGUAGES, IGNORED_FOLDERS, MAX_ANALYZABLE_BYTES, RULE_ONLY_LANGUAGES } from '../constants';
import type { WorkspaceModel } from './WorkspaceModel';

const IGNORED = new Set(IGNORED_FOLDERS);
const inIgnoredFolder = (fsPath: string) => fsPath.split(/[\\/]/).some((segment) => IGNORED.has(segment));

/** Casa com algum glob de `shieldepy.analysis.exclude`? (mesmo motor de glob do VS Code) */
export function isUserExcluded(doc: vscode.TextDocument): boolean {
  return config.excludeGlobs().some((pattern) => vscode.languages.match({ pattern, scheme: 'file' }, doc) > 0);
}

/**
 * Pode analisar este documento? (item 3.1) Só arquivo de verdade em disco — nunca o lado "antigo"
 * de um diff do git, buffer sem título, documento virtual de outra extensão, nem node_modules.
 * Sem isso, abrir um diff disparava varreduras PAGAS de conteúdo que nem é do usuário.
 */
export function isAnalyzable(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file' || doc.isUntitled) return false;
  if (!GRAPH_LANGUAGES.includes(doc.languageId) && !RULE_ONLY_LANGUAGES.includes(doc.languageId)) return false;
  if (inIgnoredFolder(doc.uri.fsPath)) return false;
  if (isUserExcluded(doc)) return false;
  return doc.getText().length <= MAX_ANALYZABLE_BYTES;
}

/** Exclusões padrão + as do usuário, num glob só (findFiles aceita um único padrão de exclusão). */
function excludePattern(): string {
  const extra = config.excludeGlobs();
  return extra.length ? `{${[EXCLUDE_GLOB, ...extra].join(',')}}` : EXCLUDE_GLOB;
}

export function findWorkspaceFiles(limit: number): Thenable<vscode.Uri[]> {
  return vscode.workspace.findFiles(FILE_GLOB, excludePattern(), limit);
}

export interface IndexReport {
  indexed: number;
  limit: number;
  /** Havia mais arquivos que o teto: o mapa ficou parcial. */
  truncated: boolean;
}

/** Indexação inicial (sem IA): grafo estrutural + regras de todos os arquivos do workspace. */
export async function indexWorkspace(model: WorkspaceModel, log: (m: string) => void): Promise<IndexReport> {
  const limit = config.maxIndexedFiles();
  // pede um a mais: é assim que se sabe que o workspace passou do teto
  const found = await findWorkspaceFiles(limit + 1);
  const truncated = found.length > limit;
  const files = truncated ? found.slice(0, limit) : found;
  log(`[index] ${files.length} arquivo(s) encontrado(s)${truncated ? ` — teto de ${limit} atingido, mapa PARCIAL` : ''}.`);
  let skipped = 0;
  for (const uri of files) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_ANALYZABLE_BYTES) {
        skipped++;
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      model.updateFile(uri.fsPath, new TextDecoder().decode(bytes));
    } catch (err) {
      log(`[index] falha ao indexar ${uri.fsPath}: ${err}`);
    }
  }
  const stats = model.graph.stats;
  log(`[index] concluído: ${stats.nodes} nós, ${stats.edges} arestas, ${model.rules.length} regra(s), ${model.collisions().length} colisão(ões)${skipped ? `, ${skipped} ignorado(s) (>2MB)` : ''}.`);
  const internal = stats.callsResolved + stats.callsHeuristic + stats.callsUnresolved;
  if (internal > 0) {
    const pct = ((100 * stats.callsResolved) / internal).toFixed(1);
    log(`[index] cobertura: ${pct}% das chamadas internas provadas (${stats.callsHeuristic} por nome, ${stats.callsUnresolved} sem alvo, ${stats.importsUnresolved} import(s) quebrado(s)).`);
  }
  return { indexed: files.length - skipped, limit, truncated };
}

/** Avisa que o workspace passou do teto e o mapa ficou parcial (com atalho pra resolver). */
export async function warnIfTruncated(report: IndexReport): Promise<void> {
  if (!report.truncated) return;
  const action = await vscode.window.showWarningMessage(
    `ShielDepy: o workspace tem mais de ${report.limit} arquivos de código — o mapa está PARCIAL. Aumente o teto ou exclua pastas geradas.`,
    'Ajustar teto',
    'Excluir pastas'
  );
  if (action === 'Ajustar teto') void vscode.commands.executeCommand('workbench.action.openSettings', 'shieldepy.index.maxFiles');
  if (action === 'Excluir pastas') void vscode.commands.executeCommand('workbench.action.openSettings', 'shieldepy.analysis.exclude');
}

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/** Relê um arquivo do disco (mudado fora do editor: git checkout, gerador, rename). */
export async function reindexFromDisk(model: WorkspaceModel, uri: vscode.Uri): Promise<void> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    model.updateFile(uri.fsPath, new TextDecoder().decode(bytes));
  } catch {
    // arquivo sumiu entre o evento e a leitura — nada a fazer
  }
}
