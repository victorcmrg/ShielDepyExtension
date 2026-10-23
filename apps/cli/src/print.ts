import { buildGraph, isSensitive, type Collision, type Rule, type SystemGraph, type TopologyGraph } from '@shieldepy/core';
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

export function printCycles(cycles: string[][], recursion: string[][], stats: { nodes: number; edges: number }, out: Out): void {
  out(`\n🗺️  grafo estrutural: ${stats.nodes} nó(s), ${stats.edges} aresta(s)`);
  if (cycles.length === 0) out('✅ nenhum ciclo de chamadas entre arquivos.');
  else {
    out(`⚠️  ${cycles.length} ciclo(s) de chamadas entre arquivos:\n`);
    for (const c of cycles) out(`  ${c.join(' → ')}`);
  }
  if (recursion.length > 0) {
    out(`\nℹ️  ${recursion.length} recursão(ões) no mesmo arquivo (em geral de propósito; confira a condição de parada):\n`);
    for (const c of recursion) out(`  ${c.join(' → ')}`);
  }
  out('');
}

/** `graph`: o tamanho do mapa e, principalmente, o quanto dele é provado. */
export function printSystemGraph(system: SystemGraph, label: string, out: Out): void {
  const s = system.stats;
  const internal = s.callsResolved + s.callsHeuristic + s.callsUnresolved;
  const pct = internal === 0 ? 100 : (100 * s.callsResolved) / internal;
  const byType = new Map<string, number>();
  for (const e of system.edges) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);

  out(`\n🗺️  mapa de ${label}`);
  out(`   ${s.files} arquivo(s), ${s.symbols} símbolo(s), ${s.packages} pacote(s) externo(s)`);
  out(`   arestas: ${[...byType].map(([t, n]) => `${n} ${t}`).join(', ')}`);
  out(`\n📐 cobertura das chamadas internas: ${pct.toFixed(1)}% provadas`);
  out(`   ${s.callsResolved} resolvidas · ${s.callsHeuristic} por nome (heurística) · ${s.callsUnresolved} sem alvo · ${s.callsExternal} para pacotes`);
  out(`   ${s.importsUnresolved} import(s) do projeto sem arquivo`);
  if (system.weakSpots.length > 0) {
    out('\n🔎 onde o mapa ainda é fraco:');
    const worst = [...system.weakSpots].sort(
      (a, b) => b.callsUnresolved + b.importsUnresolved.length - (a.callsUnresolved + a.importsUnresolved.length) || b.callsHeuristic - a.callsHeuristic
    );
    for (const w of worst.slice(0, 10)) {
      const imports = w.importsUnresolved.length > 0 ? ` · imports: ${w.importsUnresolved.join(', ')}` : '';
      out(`   ${w.file}: ${w.callsUnresolved} sem alvo, ${w.callsHeuristic} heurística(s)${imports}`);
    }
  }
  out(`\n📋 ${s.rules} regra(s) em ${system.buckets.length} balde(s), ${s.collisions} colisão(ões)`);
  out(`🔒 hash do mapa: ${system.contentHash.slice(0, 16)}\n`);
}

/** `topology`: cada rota com a cadeia de handlers, as operações em ordem e as tags. */
export function printTopology(topology: TopologyGraph, label: string, out: Out): void {
  const s = topology.stats;
  out(`\n🛣️  topologia de ${label}`);
  out(`   ${s.routes} rota(s), ${s.sensitiveRoutes} sensível(is), ${s.operations} operação(ões) de I/O, ${s.collisions} colisão(ões)`);
  if (s.callsHeuristic + s.callsUnresolved > 0) {
    out(`   ⚠️  o mapa tem ${s.callsHeuristic} chamada(s) por nome e ${s.callsUnresolved} sem alvo: veja \`shieldepy graph\``);
  }
  for (const r of topology.routes) {
    const flags = [r.confidence === 'heuristic' ? 'heurística' : '', r.truncated ? 'percurso truncado' : ''].filter(Boolean);
    out(`\n${isSensitive(r) ? '●' : '○'} ${r.id}   handlers: ${r.handlers.map((h) => h.label).join(' → ')}${flags.length ? `   [${flags.join(', ')}]` : ''}`);
    out(`    registrada em ${r.file}:${r.line + 1}`);
    for (const o of r.operations) {
      const detail = [o.via, o.lock ? 'FOR UPDATE' : '', o.timeout === 'no' ? 'sem timeout' : o.timeout === 'unknown' ? 'timeout ?' : '', o.confidence === 'heuristic' ? 'por nome' : '']
        .filter(Boolean)
        .join(', ');
      out(`  ${String(o.order).padStart(2)} ${o.kind.padEnd(10)} ${o.target.padEnd(18)} ${o.file}:${o.line + 1}  (${detail})`);
    }
    if (r.tags.length > 0) out(`    tags: ${r.tags.map((t) => (t.targets ? `${t.tag}(${t.targets.join(',')})` : t.tag)).join(', ')}`);
    if (r.collisions.length > 0) out(`    colisões no caminho: ${r.collisions.length}`);
  }
  if (topology.skipped.length > 0) {
    out('\n🔎 registros de rota que não deu para ler:');
    for (const k of topology.skipped) out(`   ${k.file}:${k.line + 1} — ${k.reason}`);
  }
  out(`\n🔒 hash da topologia: ${topology.contentHash.slice(0, 16)} (mapa ${topology.systemGraphHash.slice(0, 16)})\n`);
}
