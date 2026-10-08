// O resultado dos testes de caos (.shieldepy/chaos-results.json) vira achado com arquivo e linha:
// cada falha que quebrou o código aponta para a operação de I/O atingida (a gravação que falhou, a
// chamada à API sem timeout...). Puro, sem `vscode`: testável e usado pelo ChaosController.
import * as path from 'node:path';
import type { Finding, FindingSeverity } from '@shieldepy/core';
import type { ChaosResults } from '@shieldepy/agent/chaos';

type Outcome = ChaosResults['outcomes'][number];
type Operation = NonNullable<ChaosResults['surface']>['routes'][number]['operations'][number];

/** O que a falha injetada quer dizer, em português (o mesmo vocabulário do portal e do relatório). */
const WHAT: Record<string, (target: string) => string> = {
  race_condition: (t) => `Corrida em ${t}: requisições simultâneas quebram o estado`,
  partial_failure_after_external_call: (t) => `Falha parcial em ${t}: a API externa já foi chamada, a gravação falhou e nada foi compensado`,
  timeout: (t) => `API lenta (${t}): a rota fica sem responder`,
  http_5xx_intermittent: (t) => `API com erro (${t}): a rota não trata a falha`,
  malformed_response: (t) => `Resposta inválida de ${t}: a rota não trata a falha`,
  retry_storm: (t) => `Retentativas sem limite em ${t}`,
};

const SEVERITY: Record<string, FindingSeverity> = { Crítico: 'error', Alto: 'error', Médio: 'warning', Baixo: 'info' };

/** `src/repositories/OrderRepository.ts:14` → caminho absoluto e linha (0-based). */
function location(projectDir: string, at: string): { file: string; line: number } | undefined {
  const colon = at.lastIndexOf(':');
  if (colon <= 0) return undefined;
  const line = Number(at.slice(colon + 1));
  return { file: path.resolve(projectDir, at.slice(0, colon)), line: Number.isFinite(line) && line > 0 ? line - 1 : 0 };
}

/** As operações onde a falha bate: a gravação que falhou, a chamada à API, a escrita da corrida. */
function hitOperations(o: Outcome, ops: Operation[]): Operation[] {
  const onTarget = ops.filter((op) => op.target === o.target);
  if (o.failure === 'partial_failure_after_external_call') {
    const firstApi = ops.find((op) => op.kind === 'api_call')?.order ?? 0;
    const writes = onTarget.filter((op) => op.kind === 'db_write' && op.order > firstApi);
    return writes.length > 0 ? writes : onTarget;
  }
  if (o.failure === 'race_condition') {
    const writes = onTarget.filter((op) => op.kind === 'db_write');
    return writes.length > 0 ? writes : onTarget;
  }
  return onTarget.filter((op) => op.kind === 'api_call');
}

/**
 * Um achado por operação atingida de cada teste que quebrou (controle passou, caos falhou).
 * Sem a topologia no resultado, o achado vai para a linha da rota.
 */
export function chaosToFindings(results: ChaosResults, projectDir: string): Finding[] {
  const routes = new Map((results.surface?.routes ?? []).map((r) => [r.id, r]));
  const findings: Finding[] = [];
  for (const o of results.outcomes) {
    if (o.status !== 'failed') continue;
    const route = routes.get(o.routeId);
    const what = (WHAT[o.failure] ?? ((t: string) => `${o.failure} em ${t}`))(o.target);
    const message = `${what}. Invariante violada: ${o.message ?? 'o teste falhou'} (${o.routeId}).`;
    const test = path.resolve(projectDir, o.testFile);
    const routeAt = route ? location(projectDir, route.at) : undefined;
    const related = [
      { file: test, line: 0, message: 'o teste de caos que provou a falha (gerado pelo ShielDepy)' },
      ...(routeAt ? [{ file: routeAt.file, line: routeAt.line, message: `a rota ${o.routeId}` }] : []),
    ];
    const targets = hitOperations(o, route?.operations ?? [])
      .map((op) => ({ op, at: location(projectDir, op.at) }))
      .filter((x): x is { op: Operation; at: { file: string; line: number } } => !!x.at);
    const points = targets.length > 0 ? targets.map((x) => ({ at: x.at, where: x.op.in })) : routeAt ? [{ at: routeAt, where: o.routeId }] : [];
    for (const p of points) {
      findings.push({
        file: p.at.file,
        startLine: p.at.line,
        endLine: p.at.line,
        severity: SEVERITY[o.severity ?? ''] ?? 'warning',
        message,
        impact: `Teste de caos ${o.severity ? `(${o.severity}) ` : ''}em ${p.where}.`,
        source: 'caos',
        related,
        confidence: 100,
        key: `caos:${o.hypothesisId}:${p.at.file}:${p.at.line}`,
      });
    }
  }
  return findings;
}
