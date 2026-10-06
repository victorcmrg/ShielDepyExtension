import * as vscode from 'vscode';
import { config } from '../config';
import { EXCLUDE_GLOB, FILE_GLOB, GRAPH_LANGUAGES, MAX_ANALYZABLE_BYTES, RULE_ONLY_LANGUAGES } from '../constants';
import type { WorkspaceModel } from './WorkspaceModel';

const IGNORED_SEGMENT = /[\\/](node_modules|dist|out|\.git|bin|obj|\.venv|venv|__pycache__)[\\/]/;

/**
 * Portão por pasta: só analisa arquivos de repositórios liberados pra pessoa (definido no
 * extension.ts a partir do AuthService). Padrão aberto — os testes unitários não passam por login.
 */
let pathGate: (fsPath: string) => boolean = () => true;
export function setPathGate(gate: (fsPath: string) => boolean): void {
  pathGate = gate;
}
export function isPathAllowed(fsPath: string): boolean {
  return pathGate(fsPath);
}

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
  if (IGNORED_SEGMENT.test(doc.uri.fsPath)) return false;
  if (!pathGate(doc.uri.fsPath)) return false;
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

/** Indexação inicial (sem IA): grafo estrutural + regras de todos os arquivos do workspace. */
export async function indexWorkspace(model: WorkspaceModel, log: (m: string) => void): Promise<void> {
  const files = await findWorkspaceFiles(3000);
  log(`[index] ${files.length} arquivo(s) encontrado(s).`);
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
  const { nodes, edges } = model.graph.stats;
  log(`[index] concluído: ${nodes} nós, ${edges} arestas, ${model.rules.length} regra(s), ${model.collisions().length} colisão(ões)${skipped ? `, ${skipped} ignorado(s) (>2MB)` : ''}.`);
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
