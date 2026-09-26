import { buildGraph, type Collision, type Rule } from '@shieldepy/core';
import { AGENT_NAME, AGENT_TAGLINE, type DiagnosisReport, type Severity } from '@shieldepy/agent';

type Out = (line: string) => void;

const ICON: Record<Severity, string> = { Crítico: '🔴', Alto: '🟠', Médio: '🟡', Baixo: '🟢' };
const ENGINE: Record<DiagnosisReport['engine'], string> = { anthropic: 'IA (Claude)', gemini: 'IA (Gemini)', offline: 'explicador offline' };

/** `report`: só os fatos do motor. */
export function printCollisions(collisions: Collision[], rules: Rule[], label: string, out: Out): void {
  const where = (id: string) => {
    const loc = rules.find((r) => r.id === id)?.location;
    return loc ? ` (${loc.file.split('/').slice(-3).join('/')}:${loc.line + 1})` : '';
  };
  out(`\n📋 ${rules.length} regra(s) lida(s) de ${label}`);
  out(`🗺️  ${buildGraph(rules).buckets.size} balde(s) — recurso × evento\n`);
  if (collisions.length === 0) {
    out('✅ nenhuma colisão detectada.\n');
    return;
  }
  out(`⚠️  ${collisions.length} colisão(ões) detectada(s):\n`);
  for (const c of collisions) {
    if (c.type === 'write-write') {
      out(`  [write-write]      ${c.resource} / ${c.event} — campo "${c.field}"`);
      out(`      ${c.rules[0]}${where(c.rules[0])}`);
      out(`      ${c.rules[1]}${where(c.rules[1])}`);
      out('      escrevem o mesmo campo\n');
    } else {
      const nota =
        c.ordering === 'reader-first'
          ? 'lê valor DESATUALIZADO (roda antes de quem escreve)'
          : c.ordering === 'writer-first'
            ? 'lê o valor já alterado (roda depois de quem escreve)'
            : 'ordem indefinida — resultado imprevisível';
      out(`  [read-after-write] ${c.resource} / ${c.event} — campo "${c.field}"`);
      out(`      ${c.reader}${where(c.reader)} lê o que ${c.writer}${where(c.writer)} escreve → ${nota}\n`);
    }
  }
}

/** `explain`: diagnóstico declarativo (IA ou offline). */
export function printReport(report: DiagnosisReport, label: string, out: Out): void {
  out(`\n🛡️  ${AGENT_NAME} — ${AGENT_TAGLINE}`);
  out(`📋 Análise de ${label}`);
  out(`🧠 origem do texto: ${ENGINE[report.engine]}\n`);
  out(`📝 ${report.summary}\n`);
  report.diagnoses.forEach((d, i) => {
    out(`${ICON[d.severity]} Status: ${d.status}  |  Severidade: ${d.severity}  |  Confiança: ${d.confidence}%`);
    out(`   Chave/Namespace Afetado: ${d.affectedKey}`);
    out(`   Origens em Conflito: ${d.conflictingSources}`);
    out(`   Causa Raiz: ${d.rootCause}`);
    out(`   Recomendação Declarativa: ${d.recommendation}`);
    if (i < report.diagnoses.length - 1) out('');
  });
  out('');
}

export function printCycles(cycles: string[][], stats: { nodes: number; edges: number }, out: Out): void {
  out(`\n🗺️  grafo estrutural: ${stats.nodes} nó(s), ${stats.edges} aresta(s)`);
  if (cycles.length === 0) {
    out('✅ nenhum ciclo de chamadas.\n');
    return;
  }
  out(`⚠️  ${cycles.length} ciclo(s) de chamadas:\n`);
  for (const c of cycles) out(`  ${c.join(' → ')}`);
  out('');
}
