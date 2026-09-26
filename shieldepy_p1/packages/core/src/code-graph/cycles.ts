/** O mínimo de grafo dirigido que a busca de ciclo precisa. */
export interface DirectedView {
  hasNode(id: string): boolean;
  outNeighbors(id: string): string[];
}

/**
 * Retorna a cadeia de um ciclo dirigido passando por `nodeId` (ex: ["login", "refreshToken", "login"]),
 * ou `null` se não houver — sinal de possível loop de feedback entre componentes
 * (ex: serviço A dispara serviço B que dispara A de volta).
 */
export function findCycleThrough(graph: DirectedView, nodeId: string, hardLimit = 20000): string[] | null {
  if (!graph.hasNode(nodeId)) return null;

  // DFS iterativo (pilha explícita): a versão recursiva estourava a pilha do V8 em cadeias
  // de ~10 mil nós, antes mesmo de chegar no limite.
  const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
    { id: nodeId, neighbors: graph.outNeighbors(nodeId), next: 0 },
  ];
  const onStack = new Set<string>([nodeId]);
  // Nós já provados "sem caminho de volta pra nodeId" — é o `visited` de uma DFS de
  // alcançabilidade, então é seguro memoizar globalmente (evita reexploração exponencial).
  const deadEnd = new Set<string>();
  let visitedCount = 0;

  while (frames.length > 0) {
    const top = frames[frames.length - 1]!;
    if (top.next >= top.neighbors.length) {
      frames.pop();
      onStack.delete(top.id);
      deadEnd.add(top.id);
      continue;
    }

    const next = top.neighbors[top.next++]!;
    if (next === nodeId) return [...frames.map((f) => f.id), next];
    if (onStack.has(next) || deadEnd.has(next)) continue;
    if (++visitedCount > hardLimit) return null; // válvula de segurança pra grafos patológicos

    onStack.add(next);
    frames.push({ id: next, neighbors: graph.outNeighbors(next), next: 0 });
  }

  return null;
}
