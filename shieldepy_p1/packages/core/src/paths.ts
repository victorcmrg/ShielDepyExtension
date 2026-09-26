import * as path from 'node:path';

/**
 * Id canônico de um arquivo no grafo: caminho absoluto, barras `/`, letra de drive minúscula.
 * Antes era `uri.toString()` do VS Code — acoplava o núcleo ao editor. Normalizar a letra do
 * drive importa no Windows: o VS Code entrega `c:\...` e o Node costuma entregar `C:\...`.
 */
export function toFileId(fsPath: string): string {
  const abs = path.resolve(fsPath).replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(abs) ? abs[0]!.toLowerCase() + abs.slice(1) : abs;
}

export function extOf(fsPath: string): string {
  return path.extname(fsPath).toLowerCase();
}
