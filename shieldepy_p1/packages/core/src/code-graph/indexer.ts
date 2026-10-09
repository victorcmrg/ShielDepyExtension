import { readdirSync, type Dirent } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { Host } from '../host';
import { CodeGraph } from './CodeGraph';

// `.shieldepy`: artefatos do próprio ShielDepy (topologia exportada, testes de caos gerados) não entram no mapa;
// `.vscode-test`: o VS Code que o @vscode/test-electron baixa para os testes E2E (milhares de arquivos JS);
// `vendor`/`bower_components`: bibliotecas de terceiros copiadas; `build`, `coverage`, `.next`, `.nuxt`,
// `.svelte-kit`, `.turbo`, `.cache`, `.output`: saídas de build e de ferramenta (Q1 do plano).
export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  '.git',
  '.shieldepy',
  '.vscode-test',
  'vendor',
  'bower_components',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.output',
]);

/**
 * Arquivos de uma pasta, recursivamente, como caminhos relativos ordenados. Não desce nas pastas
 * ignoradas (`node_modules` de um projeto real tem dezenas de milhares de arquivos), e uma pasta
 * que some no meio da varredura (artefato apagado por outro processo) é pulada em vez de derrubar
 * tudo.
 */
export function walkSourceTree(root: string): string[] {
  const out: string[] = [];
  const visit = (rel: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (err) {
      if (rel && (err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const child = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) visit(child);
      } else if (e.isFile()) out.push(child);
    }
  };
  visit('');
  return out.sort();
}

const MAX_INDEX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — evita travar em bundle/arquivo gerado gigante

/**
 * Indexa uma lista de arquivos (a extensão obtém a lista via `workspace.findFiles`; CLI/testes
 * via `listSourceFiles`). Pula arquivos grandes e segue em frente em caso de erro.
 */
export async function indexFiles(graph: CodeGraph, fsPaths: string[], host: Host): Promise<{ indexed: number; skipped: number }> {
  let indexed = 0;
  let skipped = 0;
  for (const fsPath of fsPaths) {
    if (fsPath.split(/[\\/]/).some((seg) => IGNORED_DIRS.has(seg))) continue;
    try {
      if ((await stat(fsPath)).size > MAX_INDEX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      graph.updateFile(fsPath, await readFile(fsPath, 'utf8'));
      indexed += 1;
    } catch (err) {
      host.log(`[indexer] falha ao indexar ${fsPath}: ${err}`);
    }
  }
  if (skipped > 0) host.log(`[indexer] ${skipped} arquivo(s) ignorado(s) por serem maiores que 2MB.`);
  return { indexed, skipped };
}

/** Lista recursiva de arquivos suportados pelo grafo, ignorando node_modules/dist/out/.git/.shieldepy. */
export async function listSourceFiles(root: string, limit = 2000): Promise<string[]> {
  const out: string[] = [];
  for (const rel of walkSourceTree(root)) {
    if (out.length >= limit) break;
    const full = path.join(root, rel);
    if (CodeGraph.isSupported(full)) out.push(full);
  }
  return out;
}
