import { collisionKey, toFileId, type GraphSnapshot } from '@shieldepy/core';
import type { RiskFinding } from '@shieldepy/agent';
import type { WorkspaceModel } from './WorkspaceModel';

export type RiskScan = (text: string, subgraph: GraphSnapshot, provenFacts: string[]) => Promise<RiskFinding[]>;

/**
 * Verifica uma correção proposta contra o conteúdo PROPOSTO, numa CÓPIA do modelo (item 2.3):
 * a análise em background nunca enxerga o estado simulado, e não há "restaurar" pra esquecer.
 *   - ciclos no arquivo (grátis)
 *   - colisões NOVAS envolvendo o arquivo (grátis) — o fix não pode criar briga por campo
 *   - riscos via IA, se `scan` for passado (pago; a segunda tentativa não passa)
 */
export async function verifyProposedFix(model: WorkspaceModel, fsPath: string, proposedText: string, scan?: RiskScan): Promise<string[]> {
  const id = toFileId(fsPath);
  const before = model.collisionKeys(id);

  const sim = model.fork();
  sim.updateFile(fsPath, proposedText);

  const issues: string[] = [];
  const facts: string[] = [];
  for (const cycle of sim.graph.cyclesInFile(id)) {
    const text = `${cycle.recursion ? 'recursão' : 'ciclo de chamadas'}: ${cycle.labels.join(' → ')}`;
    // recursão no mesmo arquivo é fato, não barra a correção (Q3 do plano)
    if (!cycle.recursion) issues.push(text);
    facts.push(text);
  }
  for (const c of sim.collisionsInvolving(id)) {
    if (before.has(collisionKey(c))) continue;
    issues.push(`colisão nova (${c.type}) no campo "${c.field}" de ${c.resource}/${c.event}`);
  }

  if (scan) {
    const risks = await scan(proposedText, sim.graph.getImpactSubgraph(id, 2), facts);
    for (const risk of risks) {
      if (risk.severity !== 'info') issues.push(`${risk.severity}: ${risk.message}`);
    }
  }

  sim.dispose();
  return issues;
}
