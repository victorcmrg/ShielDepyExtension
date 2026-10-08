import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  attackSurface,
  buildSystemGraph,
  buildTopology,
  CodeGraph,
  indexFiles,
  listSourceFiles,
  readChaosConfig,
  silentHost,
  TsParser,
  type ChaosConfigFacts,
} from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { CHAOS_TESTS_DIR, CONTROL_TEST_NAME, renderChaosTests, runChaosPipeline, specFileName, type GeneratedFile } from '../../src/chaos';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));

async function prepare(example: string) {
  const dir = path.join(EXAMPLES, example);
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const surface = attackSurface(buildTopology(graph, buildSystemGraph(graph, [], dir), dir));
  const parser = await TsParser.load(defaultWasmDir());
  const config = parser.withTree(fs.readFileSync(path.join(dir, 'shieldepy.chaos.config.ts'), 'utf8'), false, readChaosConfig)!;
  return { dir, surface, config };
}

describe('E3/3e — contrato lido pela AST (sem executar o config)', () => {
  it('nomes de invariantes, rotas, APIs e setupFiles do checkout-express', async () => {
    const { config } = await prepare('checkout-express');
    expect(config).toEqual({
      createApp: true,
      reset: true,
      invariants: ['stockNeverNegative', 'atMostOneOrder'],
      requests: ['POST /checkout', 'GET /orders/:id'],
      apis: ['api.stripe.com'],
      setupFiles: ['chaos/setup.ts'],
    });
  });

  it('formas aceitas: objeto direto, `defineX({...})`, `const c = {...}; export default c`; sem default → undefined', async () => {
    const parser = await TsParser.load(defaultWasmDir());
    const read = (src: string) => parser.withTree(src, false, readChaosConfig);
    expect(read("export default defineChaos({ createApp, invariants: { a() { return true; } } });")).toMatchObject({ createApp: true, invariants: ['a'] });
    expect(read("const c = { reset: async () => {}, apis: { 'x.io': () => ({}) } } satisfies Cfg;\nexport default c;")).toMatchObject({ reset: true, apis: ['x.io'] });
    expect(read('export const config = {};')).toBeUndefined();
  });
});

describe('E3/3e — templates', () => {
  it('um arquivo por spec, com controle e caos; vitest.config e tsconfig herdam os do projeto', async () => {
    const { surface, config } = await prepare('checkout-express');
    const state = await runChaosPipeline(surface, { invariantNames: config.invariants, render: { config, projectViteConfig: 'vitest.config.ts', projectTsconfig: 'tsconfig.json' } });
    const paths = state.files.map((f) => f.path);
    expect(paths).toEqual([
      `${CHAOS_TESTS_DIR}/POST__checkout__race_condition__stock.spec.ts`,
      `${CHAOS_TESTS_DIR}/POST__checkout__timeout__api.stripe.com.spec.ts`,
      `${CHAOS_TESTS_DIR}/POST__checkout__http_5xx_intermittent__api.stripe.com.spec.ts`,
      `${CHAOS_TESTS_DIR}/POST__checkout__malformed_response__api.stripe.com.spec.ts`,
      `${CHAOS_TESTS_DIR}/vitest.config.ts`,
      `${CHAOS_TESTS_DIR}/tsconfig.json`,
    ]);
    expect(state.warnings).toEqual([]);

    const race = state.files[0]!.content;
    expect(race.indexOf(CONTROL_TEST_NAME)).toBeGreaterThan(0);
    expect(race.indexOf(CONTROL_TEST_NAME)).toBeLessThan(race.indexOf("it(\"caos: 10 requisições simultâneas\""));
    expect(race).toContain('await stateCheck("stockNeverNegative");');
    expect(race).toContain(`// Topologia: ${surface.topologyHash}`);

    const timeout = state.files[1]!.content;
    expect(timeout).toContain('await delay(15000);');
    expect(timeout).toContain('const outcomes = [await send(6000)];');

    const vite = state.files[4]!.content;
    expect(vite).toContain("import project from \"../../vitest.config\";");
    expect(vite).toContain('setupFiles: ["chaos/setup.ts"]');
    expect(JSON.parse(state.files[5]!.content)).toEqual({ extends: '../../tsconfig.json', compilerOptions: { noEmit: true }, include: ['./*.spec.ts'] });
  });

  it('contrato incompleto vira aviso (o teste rodaria, mas o controle cairia)', async () => {
    const { surface } = await prepare('checkout-express');
    const empty: ChaosConfigFacts = { createApp: false, reset: false, invariants: [], requests: [], apis: [], setupFiles: [] };
    const state = await runChaosPipeline(surface, { render: { config: empty } });
    expect(state.warnings).toContain('shieldepy.chaos.config.ts sem createApp(): nenhum teste consegue subir o app');
    expect(state.warnings).toContain("POST /checkout__race_condition__stock: falta requests['POST /checkout'] no config (o controle vai falhar)");
    expect(state.warnings).toContain("POST /checkout__race_condition__stock: falta apis['api.stripe.com'] no config (sem resposta saudável, o controle vai falhar)");
  });

  it('nome de arquivo seguro para qualquer id de rota', () => {
    expect(specFileName('GET /orders/:id__race_condition__orders')).toBe('GET__orders__id__race_condition__orders.spec.ts');
    expect(renderChaosTests([], { surface: { version: 1, topologyHash: 'x', routes: [], collisions: [] }, config: { createApp: true, reset: true, invariants: [], requests: [], apis: [], setupFiles: [] }, hypotheses: [] }).files).toEqual([]);
  });
});

describe('E3/3e — os testes gerados compilam contra o projeto de verdade', () => {
  for (const example of ['checkout-express', 'checkout-express-fixed']) {
    const tsc = path.join(EXAMPLES, example, 'node_modules', 'typescript', 'bin', 'tsc');
    // precisa do `npm install` dentro do exemplo; sem ele o teste é pulado (o CI da E4 instala)
    it.skipIf(!fs.existsSync(tsc))(`${example}: tsc -p ${CHAOS_TESTS_DIR}`, async () => {
      const { dir, surface, config } = await prepare(example);
      const written: GeneratedFile[] = [];
      await runChaosPipeline(surface, {
        invariantNames: config.invariants,
        render: { config, projectViteConfig: 'vitest.config.ts', projectTsconfig: 'tsconfig.json' },
        io: {
          write: async (files) => {
            for (const f of files) {
              const full = path.join(dir, f.path);
              fs.mkdirSync(path.dirname(full), { recursive: true });
              fs.writeFileSync(full, f.content);
              written.push(f);
            }
          },
        },
      });
      try {
        expect(written.length).toBeGreaterThan(2);
        // lança com a saída do tsc se algum arquivo gerado não compilar
        execFileSync(process.execPath, [tsc, '-p', CHAOS_TESTS_DIR], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
      } finally {
        fs.rmSync(path.join(dir, CHAOS_TESTS_DIR), { recursive: true, force: true });
      }
    }, 120_000);
  }
});
