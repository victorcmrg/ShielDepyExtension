// Impressão digital do código pela AST: o diff entre dois mapas (E5) precisa saber se o CORPO de
// uma função mudou, sem cair em falso positivo por comentário, espaço ou linha deslocada, e sem
// depender do nome (renomear sem mexer no corpo é `renamed`, não remoção + adição).

import { createHash } from 'node:crypto';
import type { SyntaxNode } from './parser';

/** Separador entre tokens: `ab` + `c` não pode dar o mesmo hash que `a` + `bc`. */
const SEP = '\u0001';

/**
 * Hash das folhas da AST (tipo + texto), em ordem, sem comentários. Inclui pontuação e operadores:
 * `a + b` e `a - b` diferem. `accept` filtra as folhas: tira o nome do próprio símbolo, ou fica só
 * com o que está fora dos símbolos (o código de topo do arquivo).
 */
function leafHash(node: SyntaxNode, accept: (leaf: SyntaxNode) => boolean): string {
  const h = createHash('sha256');
  const visit = (n: SyntaxNode) => {
    if (n.type === 'comment') return;
    if (n.childCount === 0) {
      if (accept(n)) h.update(n.type + SEP + n.text + SEP);
      return;
    }
    for (const c of n.children) visit(c);
  };
  visit(node);
  return h.digest('hex').slice(0, 16);
}

/** Corpo de um símbolo; `name` (o nó do nome, quando ele está dentro do nó hasheado) fica de fora. */
export function bodyHash(node: SyntaxNode, name?: SyntaxNode | null): string {
  if (!name) return leafHash(node, () => true);
  const from = name.startIndex;
  const to = name.endIndex;
  return leafHash(node, (leaf) => leaf.startIndex < from || leaf.startIndex >= to);
}

/** Código de topo do arquivo: tudo o que está FORA dos símbolos (imports, montagem, `new X()` exportado). */
export function topLevelHash(root: SyntaxNode, symbolRanges: { startIndex: number; endIndex: number }[]): string {
  const ranges = [...symbolRanges].sort((a, b) => a.startIndex - b.startIndex);
  return leafHash(root, (leaf) => !ranges.some((r) => leaf.startIndex >= r.startIndex && leaf.startIndex < r.endIndex));
}
