import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { Host } from '../host';
import { CodeGraph } from './CodeGraph';

// `.shieldepy`: artefatos do próprio ShielDepy (topologia exportada, testes de caos gerados) não entram no mapa
export const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', '.git', '.shieldepy']);
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
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limit) break;
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? (entry as { path?: string }).path ?? root, entry.name);
    const rel = path.relative(root, full);
    if (rel.split(path.sep).some((seg) => IGNORED_DIRS.has(seg))) continue;
    if (CodeGraph.isSupported(full)) out.push(full);
  }
  return out;
}
