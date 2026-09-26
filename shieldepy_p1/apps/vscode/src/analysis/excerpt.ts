const CONTEXT_LINES = 8; // linhas de contexto ao redor do trecho alterado, mandadas junto pra IA
const EXCERPT_MAX_RATIO = 0.7; // se o trecho "alterado" já cobre isso do arquivo, manda o arquivo inteiro

export interface Excerpt {
  text: string;
  /** Linhas (0-based) do trecho no texto NOVO. */
  startLine: number;
  endLine: number;
  /** Última linha alterada no texto ANTIGO — o que vem depois dela só deslocou. */
  oldChangedEnd: number;
  /** Quantas linhas o arquivo ganhou (+) ou perdeu (−). */
  lineDelta: number;
}

/**
 * Diff leve sem dependência: maior prefixo e sufixo de linhas iguais entre a última versão
 * verificada e a atual — o meio é "o que mudou". Diferente da versão anterior, funciona também
 * quando a contagem de linhas muda (o caso mais comum ao editar): o que vem depois do trecho só
 * desloca `lineDelta` linhas. `null` = sem corte vantajoso, mande o arquivo inteiro.
 */
export function computeChangedExcerpt(oldText: string, newText: string): Excerpt | null {
  if (oldText === newText) return null;

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const max = Math.min(oldLines.length, newLines.length);

  let prefix = 0;
  while (prefix < max && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;

  const total = newLines.length;
  const startLine = Math.max(prefix - CONTEXT_LINES, 0);
  const endLine = Math.max(Math.min(total - 1 - suffix + CONTEXT_LINES, total - 1), startLine);
  if (endLine - startLine + 1 >= total * EXCERPT_MAX_RATIO) return null;

  return {
    text: newLines.slice(startLine, endLine + 1).join('\n'),
    startLine,
    endLine,
    oldChangedEnd: oldLines.length - 1 - suffix,
    lineDelta: newLines.length - oldLines.length,
  };
}

/**
 * Achados antigos que continuam válidos sem reverificar: os ANTES do trecho ficam onde estão;
 * os DEPOIS da parte alterada são deslocados por `lineDelta`. Os que caem no trecho reanalisado somem.
 */
export function preserveOutside<T extends { startLine: number; endLine: number }>(old: T[], excerpt: Excerpt): T[] {
  const before = old.filter((f) => f.endLine < excerpt.startLine);
  const after = old
    .filter((f) => f.startLine > excerpt.oldChangedEnd)
    .map((f) => ({ ...f, startLine: f.startLine + excerpt.lineDelta, endLine: f.endLine + excerpt.lineDelta }))
    .filter((f) => f.startLine > excerpt.endLine);
  return [...before, ...after];
}
