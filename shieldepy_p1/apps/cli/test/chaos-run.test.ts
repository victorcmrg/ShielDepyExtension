import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChaosRunError, classifyVitestReport, cleanFailureMessage, runChaosTests, vitestEntry, type ProcessRunner } from '../src/chaos-run';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const example = (rel: string) => path.join(ROOT, 'examples', rel);
// JSON real do reporter do Vitest nos testes gerados do checkout-express (encurtado), mais um
// controle que falhou e um arquivo que não carregou
const FIXTURE = fileURLToPath(new URL('./fixtures/vitest-chaos-report.json', import.meta.url));
const report = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const RACE = 'POST /checkout__race_condition__stock';
const TIMEOUT = 'POST /checkout__timeout__api.stripe.com';
const H5XX = 'POST /checkout__http_5xx_intermittent__api.stripe.com';
const MALFORMED = 'POST /checkout__malformed_response__api.stripe.com';
const CONTROL_FAILED = 'GET /orders/:id__timeout__api.x.com';
const NOT_LOADED = 'POST /pay__race_condition__orders';

describe('runner dos testes de caos (E4/4a)', () => {
  it('limpa a mensagem da asserção: sem o tipo do erro, sem o "expected" e só a 1ª linha', () => {
    expect(cleanFailureMessage('AssertionError: stateCheck: stockNeverNegative: expected false to be true // Object.is equality\n    at x')).toBe('stateCheck: stockNeverNegative');
    expect(cleanFailureMessage('AssertionError: statusIn: a rota não respondeu em 10007 ms: expected [ 502, 503, 504 ] to include undefined')).toBe(
      'statusIn: a rota não respondeu em 10007 ms'
    );
    expect(cleanFailureMessage('Error: Test timed out in 20000ms.')).toBe('Test timed out in 20000ms.');
    expect(cleanFailureMessage(undefined)).toBe('falhou sem mensagem');
  });

  it('classifica pelo par controle × caos, no formato medido no checkout-express', () => {
    const results = classifyVitestReport(report(), [RACE, TIMEOUT, H5XX, MALFORMED, CONTROL_FAILED, NOT_LOADED]);
    expect(results.map((r) => [r.hypothesisId, r.status, r.message])).toEqual([
      [RACE, 'failed', 'stateCheck: stockNeverNegative'],
      [TIMEOUT, 'failed', 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta'],
      [H5XX, 'failed', expect.stringMatching(/^statusIn: a rota não respondeu em \d+ ms$/)],
      [MALFORMED, 'failed', expect.stringMatching(/^statusIn: a rota não respondeu em \d+ ms$/)],
      // controle falhou: o teste ou o ambiente está ruim, e isso não é achado
      [CONTROL_FAILED, 'invalid', 'o controle (sem caos) falhou: statusIn: esperado 2xx, veio 500'],
      // arquivo que não carregou: o id sai do nome do arquivo
      [NOT_LOADED, 'invalid', expect.stringMatching(/^o teste não carregou: Failed to load url \.\/naoexiste/)],
    ]);
    // a duração é a do teste de caos
    expect(results[1]!.durationMs).toBeGreaterThanOrEqual(6000);
  });

  it('caos passou → passed; hipótese sem resultado → invalid ("não rodou"), sem sumir do relatório', () => {
    const r = report();
    for (const f of r.testResults) for (const a of f.assertionResults) if (a.ancestorTitles[0] === RACE) a.status = 'passed';
    const results = classifyVitestReport(r, [RACE, 'POST /x__timeout__api.y.com']);
    expect(results.find((x) => x.hypothesisId === RACE)).toMatchObject({ status: 'passed' });
    expect(results.find((x) => x.hypothesisId === 'POST /x__timeout__api.y.com')).toMatchObject({ status: 'invalid', message: expect.stringMatching(/não rodou/) });
  });

  it('chama o Vitest do projeto com o reporter JSON num arquivo temporário (processo injetado)', async () => {
    const dir = example('checkout-express');
    if (!vitestEntry(dir)) return; // sem npm install no exemplo, não há o que conferir
    const calls: string[][] = [];
    const fake: ProcessRunner = async (cmd, args, cwd) => {
      calls.push([cmd, ...args, cwd]);
      const out = args.find((a) => a.startsWith('--outputFile='))!.slice('--outputFile='.length);
      fs.writeFileSync(out, fs.readFileSync(FIXTURE));
      return { code: 1, output: '' };
    };
    const results = await runChaosTests(dir, [RACE], fake);
    expect(calls[0]!.slice(1, 6)).toEqual([vitestEntry(dir), 'run', '--config', '.shieldepy/chaos-tests/vitest.config.ts', '--reporter=json']);
    expect(calls[0]![0]).toBe(process.execPath);
    expect(calls[0]!.at(-1)).toBe(dir);
    expect(results.find((r) => r.hypothesisId === RACE)?.status).toBe('failed');
    // o arquivo temporário é apagado
    const out = calls[0]!.find((a) => a.startsWith('--outputFile='))!.slice('--outputFile='.length);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('erro de ambiente vira ChaosRunError: sem Vitest instalado, ou o Vitest não gerou o relatório', async () => {
    await expect(runChaosTests(example('pedidos-microservices'), [RACE])).rejects.toThrow(ChaosRunError);
    const dir = example('checkout-express');
    if (!vitestEntry(dir)) return;
    const crashed: ProcessRunner = async () => ({ code: 1, output: 'Error: Cannot find module vitest.config.ts' });
    await expect(runChaosTests(dir, [RACE], crashed)).rejects.toThrow(/sem gerar o relatório:\nError: Cannot find module/);
  });
});
