import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attackSurface, buildSystemGraph, buildTopology, CodeGraph, indexFiles, listSourceFiles, readChaosConfig, silentHost, toFileId, TsParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import {
  asMutantRecord,
  buildDatasetRecords,
  chaosOutcomes,
  datasetRecordId,
  datasetJsonl,
  mergeDatasetJsonl,
  routeCode,
  runChaosPipeline,
  runStatuses,
  type DatasetInput,
  type DatasetSource,
  type TestResult,
} from '../../src/chaos';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const RACE = 'POST /checkout__race_condition__stock';
const TIMEOUT = 'POST /checkout__timeout__api.stripe.com';

async function prepare(example: string) {
  const dir = path.join(EXAMPLES, example);
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const topology = buildTopology(graph, buildSystemGraph(graph, [], dir), dir);
  const surface = attackSurface(topology);
  const parser = await TsParser.load(defaultWasmDir());
  const config = parser.withTree(fs.readFileSync(path.join(dir, 'shieldepy.chaos.config.ts'), 'utf8'), false, readChaosConfig)!;
  const state = await runChaosPipeline(surface, { invariantNames: config.invariants, render: { config } });
  const code = routeCode(topology.routes, graph, toFileId(dir), (id) => fs.readFileSync(id, 'utf8'));
  return { surface, state, code };
}

const source: DatasetSource = {
  project: 'checkout-express',
  repo: 'https://github.com/exemplo/shieldepy.git',
  commit: 'abc123',
  path: 'examples/checkout-express',
  license: { value: 'MIT', from: 'package.json' },
  variant: 'original',
};

let prepared: ReturnType<typeof prepare> | undefined;

async function input(results: (ids: string[]) => TestResult[]): Promise<DatasetInput> {
  const { surface, state, code } = await (prepared ??= prepare('checkout-express'));
  return {
    source,
    surface,
    code,
    engine: state.engine,
    hypotheses: state.hypotheses,
    rejected: state.rejected,
    specs: state.specs,
    errors: state.errors,
    files: state.files,
    outcomes: chaosOutcomes(results(state.specs.map((s) => s.hypothesisId)), state.hypotheses),
  };
}

const allPassed = (ids: string[]): TestResult[] => ids.map((id) => ({ hypothesisId: id, status: 'passed', durationMs: 5 }));

describe('D1 — o registro do dataset (JSONL v1)', () => {
  it('o achado de corrida do checkout-express, campo a campo', async () => {
    const inp = await input((ids) =>
      ids.map((id) => ({ hypothesisId: id, status: id === RACE ? 'failed' : 'passed', message: id === RACE ? 'stateCheck: stockNeverNegative' : undefined, durationMs: 120 }))
    );
    const records = buildDatasetRecords(inp);
    expect(records).toHaveLength(6);
    const r = records.find((x) => x.hypothesis.id === RACE)!;

    expect(r.id).toMatch(/^[0-9a-f]{32}$/);
    expect(r.schemaVersion).toBe(1);
    expect(r.source).toEqual(source);
    expect(r.topologyHash).toBe(inp.surface.topologyHash);

    expect(r.route).toMatchObject({ id: 'POST /checkout', method: 'POST', path: '/checkout', at: 'src/routes/checkout.ts:8', confidence: 'proven' });
    expect(r.route.handlers).toEqual(['express.json()', 'validateCheckout', 'checkoutController.create']);
    expect(r.route.operations.map((o) => `${o.order} ${o.kind} ${o.target} ${o.at} ${o.in} ${o.confidence}`)).toEqual([
      '1 db_read stock src/repositories/StockRepository.ts:7 StockRepository.available proven',
      '2 api_call api.stripe.com src/gateways/StripeGateway.ts:8 StripeGateway.charge proven',
      '3 db_write stock src/repositories/StockRepository.ts:12 StockRepository.decrement proven',
      '4 db_write orders src/repositories/OrderRepository.ts:14 OrderRepository.insert proven',
    ]);
    expect(r.route.operations[1]).toMatchObject({ via: 'fetch', timeout: 'no' });
    expect(r.route.tags.map((t) => t.tag)).toEqual(['external-io', 'no-timeout', 'no-transaction', 'read-then-write', 'write-after-api-call']);

    // a cadeia: middleware → controller → service → cada função que faz I/O, na ordem
    expect(r.code.map((c) => `${c.at}-${c.endLine} ${c.symbol.slice(c.symbol.indexOf('#') + 1)}`)).toEqual([
      'src/middleware/validate.ts:3-10 validateCheckout',
      'src/controllers/CheckoutController.ts:8-16 CheckoutController.create',
      'src/services/CheckoutService.ts:24-31 CheckoutService.checkout',
      'src/repositories/StockRepository.ts:6-9 StockRepository.available',
      'src/gateways/StripeGateway.ts:7-15 StripeGateway.charge',
      'src/repositories/StockRepository.ts:11-13 StockRepository.decrement',
      'src/repositories/OrderRepository.ts:13-19 OrderRepository.insert',
    ]);
    const service = r.code[2]!.text;
    expect(service.startsWith('  async checkout(input: CheckoutInput): Promise<Order> {\n')).toBe(true);
    expect(service).toContain('await this.stock.decrement(input.productId, input.quantity);');
    expect(service.endsWith('  }')).toBe(true);
    expect(r.code.every((c) => !c.text.includes('\r'))).toBe(true);

    expect(r.hypothesis).toMatchObject({
      id: RACE,
      failure: 'race_condition',
      agent: 'concurrency',
      target: 'stock',
      priority: 1,
      author: { engine: 'offline' },
      specAuthor: { engine: 'offline' },
      discarded: [],
    });
    expect(r.hypothesis.rationale).toContain('read-then-write(stock)');
    expect(r.hypothesis.spec).toMatchObject({ kind: 'concurrency', hypothesisId: RACE, routeId: 'POST /checkout', parallel: 10, source: 'motor' });

    expect(r.result).toEqual({
      control: 'passed',
      chaos: 'failed',
      outcome: 'achado',
      message: 'stateCheck: stockNeverNegative',
      violated: { kind: 'stateCheck', name: 'stockNeverNegative' },
      severity: 'Crítico',
      durationMs: 120,
    });
    expect(r.test.file).toBe('.shieldepy/chaos-tests/POST__checkout__race_condition__stock.spec.ts');
    expect(r.test.text).toBe(inp.files.find((f) => f.path === r.test.file)!.content);
    expect(r.test.text).toContain('controle: a mesma requisição, sem caos, funciona');

    const passed = records.find((x) => x.hypothesis.id === TIMEOUT)!;
    expect(passed.result).toEqual({ control: 'passed', chaos: 'passed', outcome: 'aguentou', durationMs: 120 });
  });

  it('a mesma entrada dá o mesmo JSONL, em qualquer ordem; o id muda com a variante', async () => {
    const inp = await input(allPassed);
    const a = datasetJsonl(buildDatasetRecords(inp));
    const b = datasetJsonl(buildDatasetRecords({ ...inp, outcomes: [...inp.outcomes].reverse(), specs: [...inp.specs].reverse(), hypotheses: [...inp.hypotheses].reverse() }));
    expect(b).toBe(a);
    const lines = a.trimEnd().split('\n');
    expect(lines).toHaveLength(6);
    expect(JSON.parse(lines[0]!).schemaVersion).toBe(1);
    const original = buildDatasetRecords(inp)[0]!;
    const fixed = buildDatasetRecords({ ...inp, source: { ...source, variant: 'fixed' } })[0]!;
    expect(fixed.id).not.toBe(original.id);
    expect(fixed.hypothesis.id).toBe(original.hypothesis.id);
    // um commit novo do repositório com o mesmo código: mesmo id (o banco não duplica)
    const otherCommit = buildDatasetRecords({ ...inp, source: { ...source, commit: 'def456' } })[0]!;
    expect(otherCommit.id).toBe(original.id);
    expect(otherCommit.source.commit).toBe('def456');
    // o código mudou: outro id
    const code = { ...inp.code, [original.route.id]: inp.code[original.route.id]!.map((c, i) => (i === 0 ? { ...c, text: c.text + '\n// mudou' } : c)) };
    expect(buildDatasetRecords({ ...inp, code })[0]!.id).not.toBe(original.id);
  });

  it('inválido vai com o motivo; sem resultado não há registro', async () => {
    const inp = await input((ids) => [
      { hypothesisId: ids[0]!, status: 'invalid', message: 'o controle (sem caos) falhou: 500', durationMs: 3 },
      { hypothesisId: ids[1]!, status: 'invalid', message: 'a falha não disparou: nenhum INSERT em orders depois da API', durationMs: 3 },
    ]);
    const records = buildDatasetRecords(inp);
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.result.message!.startsWith('o controle'))!.result).toMatchObject({ control: 'failed', chaos: 'not-run', outcome: 'inválido' });
    expect(records.find((r) => r.result.message!.startsWith('a falha'))!.result).toMatchObject({ control: 'passed', chaos: 'not-run', outcome: 'inválido' });
    expect(runStatuses({ status: 'invalid', message: 'o teste não carregou: x' })).toEqual({ control: 'not-run', chaos: 'not-run' });
    expect(runStatuses({ status: 'invalid', message: 'o teste de caos não rodou (skipped)' })).toEqual({ control: 'passed', chaos: 'not-run' });
  });

  it('o corpus: um registro por id (o último vence), em ordem, e linha estranha fica fora', async () => {
    const inp = await input(allPassed);
    const first = datasetJsonl(buildDatasetRecords(inp));
    const again = datasetJsonl(buildDatasetRecords({ ...inp, outcomes: inp.outcomes.map((o) => ({ ...o, durationMs: 99 })) }));
    const fixed = datasetJsonl(buildDatasetRecords({ ...inp, source: { ...source, project: 'checkout-express-fixed', variant: 'fixed' } }));
    const { records, duplicates, skipped } = mergeDatasetJsonl([fixed, first, 'não é json\n{"schemaVersion":2,"id":"x"}\n', again]);
    expect(records).toHaveLength(12);
    expect(duplicates).toBe(6);
    expect(skipped).toBe(2);
    expect(records.slice(0, 6).every((r) => r.source.variant === 'original' && r.result.durationMs === 99)).toBe(true);
    expect(records.map((r) => r.hypothesis.id).slice(0, 6)).toEqual([...records.map((r) => r.hypothesis.id).slice(0, 6)].sort());
    expect(datasetJsonl(mergeDatasetJsonl([again, fixed]).records)).toBe(datasetJsonl(records));
  });

  it('o mutante leva a fonte do original, a variante e a mutação, com id próprio', async () => {
    const inp = await input(allPassed);
    const ran = buildDatasetRecords({ ...inp, source: { project: 'checkout-express__sem-timeout-1', variant: 'original' } })[0]!;
    const mutation = { operator: 'sem-timeout', file: 'src/gateways/StripeGateway.ts', line: 17, description: 'tira o signal de fetch' };
    const m = asMutantRecord(ran, source, mutation, 'mutante:sem-timeout@src/gateways/StripeGateway.ts:17', 'offline');
    expect(m.source).toEqual({ ...source, variant: 'mutante:sem-timeout@src/gateways/StripeGateway.ts:17', mutation });
    expect(m.id).toBe(datasetRecordId(m, 'offline'));
    expect(m.id).not.toBe(buildDatasetRecords(inp)[0]!.id);
    expect(m.hypothesis).toEqual(ran.hypothesis);
  });

  it('com a IA: o provedor e o modelo de quem escreveu, e o que a validação descartou', async () => {
    const inp = await input(allPassed);
    const records = buildDatasetRecords({
      ...inp,
      engine: 'anthropic',
      model: 'claude-haiku-5-5',
      hypotheses: inp.hypotheses.map((h) => (h.id === RACE ? { ...h, source: 'motor+ia' as const } : h)),
      rejected: [{ index: 3, reason: 'rota fora da superfície: POST /inventada' }],
      errors: [`concurrency ${RACE}: spec da IA inválida; o motor completou`, `network ${TIMEOUT}: outra`],
    });
    const r = records.find((x) => x.hypothesis.id === RACE)!;
    expect(r.hypothesis.author).toEqual({ engine: 'anthropic', model: 'claude-haiku-5-5' });
    expect(r.hypothesis.specAuthor).toEqual({ engine: 'offline' }); // a spec é do motor
    expect(r.hypothesis.discarded).toEqual(['threat_modeler #3: rota fora da superfície: POST /inventada', `concurrency ${RACE}: spec da IA inválida; o motor completou`]);
    expect(records.find((x) => x.hypothesis.id === TIMEOUT)!.hypothesis.author).toEqual({ engine: 'offline' });
  });
});
