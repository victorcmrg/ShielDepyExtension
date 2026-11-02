import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attackSurface, buildSystemGraph, buildTopology, CodeGraph, indexFiles, listSourceFiles, readChaosConfig, silentHost, toFileId, TsParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { asMutantRecord, buildDatasetRecords, chaosOutcomes, datasetFamily, dpoPairs, routeCode, runChaosPipeline, type DatasetRecord, type DatasetSource, type TestResult } from '../../src/chaos';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const RACE = 'POST /checkout__race_condition__stock';
const PARTIAL_STOCK = 'POST /checkout__partial_failure_after_external_call__stock';

/** Os registros de um exemplo, com o resultado que o teste pede (o motor offline de verdade, sem rodar o Vitest). */
async function records(example: string, variant: DatasetSource['variant'], status: (id: string) => TestResult['status']): Promise<DatasetRecord[]> {
  const dir = path.join(EXAMPLES, example);
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const topology = buildTopology(graph, buildSystemGraph(graph, [], dir), dir);
  const surface = attackSurface(topology);
  const parser = await TsParser.load(defaultWasmDir());
  const config = parser.withTree(fs.readFileSync(path.join(dir, 'shieldepy.chaos.config.ts'), 'utf8'), false, readChaosConfig)!;
  const state = await runChaosPipeline(surface, { invariantNames: config.invariants, render: { config } });
  const results: TestResult[] = state.specs.map((s) => {
    const st = status(s.hypothesisId);
    return { hypothesisId: s.hypothesisId, status: st, durationMs: 5, ...(st === 'failed' && { message: 'stateCheck: stockNeverNegative' }), ...(st === 'invalid' && { message: 'a falha não disparou' }) };
  });
  return buildDatasetRecords({
    source: { project: example, repo: 'https://github.com/exemplo/shieldepy.git', commit: 'abc', variant },
    surface,
    code: routeCode(topology.routes, graph, toFileId(dir), (id) => fs.readFileSync(id, 'utf8')),
    engine: 'offline',
    hypotheses: state.hypotheses,
    rejected: [],
    specs: state.specs,
    errors: [],
    files: state.files,
    outcomes: chaosOutcomes(results, state.hypotheses),
  });
}

describe('D5 — pares para o DPO', () => {
  it('correção: achado no original × aguentou no -fixed, mesma hipótese; o inválido não vira par', async () => {
    const original = await records('checkout-express', 'original', () => 'failed');
    const fixed = await records('checkout-express-fixed', 'fixed', (id) => (id === PARTIAL_STOCK ? 'invalid' : 'passed'));
    expect(datasetFamily(original[0]!)).toBe(datasetFamily(fixed[0]!));

    const pairs = dpoPairs([...fixed, ...original]).filter((p) => p.kind === 'correcao');
    // o -fixed não tem a hipótese de timeout (já tem timeout), e a partial em stock saiu inválida
    expect(pairs.map((p) => p.provenance.hypothesisId)).toEqual([
      'POST /checkout__http_5xx_intermittent__api.stripe.com',
      'POST /checkout__malformed_response__api.stripe.com',
      'POST /checkout__partial_failure_after_external_call__orders',
      RACE,
    ]);
    const race = pairs.find((p) => p.provenance.hypothesisId === RACE)!;
    expect(race.provenance.variants).toEqual({ chosen: 'fixed', rejected: 'original' });
    // o template que a equipe de treino especificou, na ordem
    expect(race.prompt.startsWith('Analise o seguinte código de rota e corrija a vulnerabilidade identificada:\n[VULNERABILIDADE / ACHADO]\nRota POST /checkout: race_condition em stock: stateCheck: stockNeverNegative (Crítico)\n\n[CÓDIGO DA ROTA]\n// src/middleware/validate.ts:3\n')).toBe(true);
    expect(race.prompt).toContain('// src/services/CheckoutService.ts:24');
    expect(race.prompt.endsWith('\n\nResponda apenas com o código corrigido.')).toBe(true);
    expect(race.provenance).toMatchObject({ repo: 'https://github.com/exemplo/shieldepy.git', commits: { chosen: 'abc', rejected: 'abc' } });
    expect(race.chosen).toContain('AbortSignal.timeout(STRIPE_TIMEOUT_MS)');
    expect(race.rejected).not.toContain('AbortSignal');
    expect(race.provenance.weak).toBeUndefined();
  });

  it('mutante: vira o rejected do código que aguentou, nunca o chosen', async () => {
    const fixed = await records('checkout-express-fixed', 'fixed', () => 'passed');
    const base = fixed[0]!.source;
    const mutation = { operator: 'sem-estorno', file: 'src/services/CheckoutService.ts', line: 51, description: 'o estorno do catch vira false' };
    const variant = 'mutante:sem-estorno@src/services/CheckoutService.ts:51' as const;
    // no mutante, só a partial em orders quebra; o resto aguentou
    const mutant = (await records('checkout-express-fixed', variant, (id) => (id.endsWith('__orders') ? 'failed' : 'passed'))).map((r) =>
      asMutantRecord(r, base, mutation, variant, 'offline')
    );
    const original = await records('checkout-express', 'original', () => 'failed');
    const pairs = dpoPairs([...original, ...fixed, ...mutant]).filter((p) => p.kind === 'correcao');
    expect(pairs.every((p) => !p.provenance.variants.chosen.startsWith('mutante:'))).toBe(true);
    const fromMutant = pairs.filter((p) => p.provenance.variants.rejected === variant);
    expect(fromMutant.map((p) => [p.provenance.hypothesisId, p.provenance.variants.chosen])).toEqual([['POST /checkout__partial_failure_after_external_call__orders', 'fixed']]);
  });

  it('diagnóstico (fraco): na mesma rota, a falha que deu achado × a que aguentou; mesma entrada, mesmos pares', async () => {
    const original = await records('checkout-express', 'original', (id) => (id === RACE ? 'failed' : 'passed'));
    const pairs = dpoPairs(original);
    expect(pairs.every((p) => p.kind === 'diagnostico' && p.provenance.weak)).toBe(true);
    expect(pairs).toHaveLength(5);
    expect(pairs[0]!.prompt.startsWith('Analise o seguinte código de rota e identifique potenciais vulnerabilidades de concorrência, latência ou estado:\n\n[CÓDIGO DA ROTA]\n// src/middleware/validate.ts:3\n')).toBe(true);
    expect(new Set(pairs.map((p) => p.provenance.chosenRecord)).size).toBe(1);
    expect(pairs[0]!.chosen).toBe('race_condition em stock: stateCheck: stockNeverNegative (Crítico)');
    expect(pairs.map((p) => p.rejected)).toContain('timeout em api.stripe.com');
    expect(dpoPairs([...original].reverse())).toEqual(pairs);
  });
});
