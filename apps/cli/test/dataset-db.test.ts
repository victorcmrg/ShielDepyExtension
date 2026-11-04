import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRegistry } from '@shieldepy/extractors';
import { datasetJsonl, dpoPairs, type DatasetRecord } from '@shieldepy/agent/chaos';
import { runChaosCommand, type ChaosTestRunner } from '../src/chaos';
import { DATASET_DB_ENV, DATASET_TABLE, dbHost, DPO_TABLE, exportChaosDataset, publishDataset, publishDatasetFile, publishDpoPairs, readDatasetRecords, type SqlConnect } from '../src/dataset';
import { runChaosChild } from '../../../scripts/dataset-corpus';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const example = (rel: string) => path.join(ROOT, 'examples', rel);
const RACE = 'POST /checkout__race_condition__stock';

/**
 * Uma cópia do checkout-express numa pasta temporária (com o mesmo nome, para os registros saírem
 * iguais). O caos grava em `<projeto>/.shieldepy/chaos-tests`, e o cli.test.ts usa essa pasta do
 * exemplo ao mesmo tempo, noutro fork: rodando no exemplo, um apagava a pasta do outro.
 */
function checkoutCopy(): { dir: string; cleanup: () => void } {
  const src = example('checkout-express');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-db-ex-'));
  const dir = path.join(tmp, 'checkout-express');
  const skip = new Set(['node_modules', '.shieldepy']);
  fs.cpSync(src, dir, { recursive: true, filter: (from) => !skip.has(path.relative(src, from).split(path.sep)[0]!) });
  return { dir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/** Um Postgres de verdade (PGlite, no processo) atrás da interface que o envio usa. */
function pglite(): { db: PGlite; connect: SqlConnect; ended: () => number } {
  const db = new PGlite();
  let ended = 0;
  return {
    db,
    connect: async () => ({
      query: (text, values) => db.query(text, values as any[]),
      end: async () => {
        ended++;
      },
    }),
    ended: () => ended,
  };
}

/** Os registros reais do checkout-express, pelo `chaos --dataset` com o runner injetado. */
async function checkoutRecords(): Promise<DatasetRecord[]> {
  const { dir, cleanup } = checkoutCopy();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-db-'));
  const file = path.join(tmp, 'd.jsonl');
  const runner: ChaosTestRunner = async (_root, ids) =>
    ids.map((id) => ({ hypothesisId: id, status: id === RACE ? 'failed' : 'passed', message: id === RACE ? 'stateCheck: stockNeverNegative' : undefined, durationMs: 10 }));
  try {
    await runChaosCommand({ target: dir, json: false, noRun: false, offline: true, dataset: file }, { out: () => {}, err: () => {}, env: {} }, () => loadRegistry(defaultWasmDir()), runner);
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup();
  }
}

describe('0020 — o dataset vai para o banco do treino', () => {
  it('cria a tabela, grava por upsert no id e não duplica ao rodar de novo', async () => {
    const records = await checkoutRecords();
    const { db, connect, ended } = pglite();
    expect(await publishDataset(records, 'postgres://u:senha@neon.exemplo/db', connect)).toBe(6);
    expect(await publishDataset(records, 'postgres://u:senha@neon.exemplo/db', connect)).toBe(6);
    expect(ended()).toBe(2);

    const rows = (await db.query<{ id: string; project: string; variant: string; outcome: string; control: string; failure: string }>(
      `SELECT id, project, variant, outcome, control, record->'hypothesis'->>'failure' AS failure FROM ${DATASET_TABLE} ORDER BY hypothesis_id`
    )).rows;
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.project === 'checkout-express' && r.variant === 'original' && r.control === 'passed')).toBe(true);
    expect(rows.filter((r) => r.outcome === 'achado').map((r) => r.failure)).toEqual(['race_condition']);
    // o jsonb guarda o registro inteiro: o código da rota vai junto
    const code = (await db.query<{ n: number }>(`SELECT jsonb_array_length(record->'code') AS n FROM ${DATASET_TABLE} WHERE hypothesis_id = $1`, [RACE])).rows[0]!;
    expect(code.n).toBeGreaterThan(3);

    // uma nova execução com outro resultado atualiza a linha
    const again = records.map((r) => (r.hypothesis.id === RACE ? { ...r, result: { ...r.result, outcome: 'aguentou' as const, chaos: 'passed' as const } } : r));
    await publishDataset(again, 'x', connect);
    expect((await db.query<{ outcome: string }>(`SELECT outcome FROM ${DATASET_TABLE} WHERE hypothesis_id = $1`, [RACE])).rows[0]!.outcome).toBe('aguentou');
    expect((await db.query(`SELECT 1 FROM ${DATASET_TABLE}`)).rows).toHaveLength(6);
  }, 60_000);

  it('em lotes: 120 registros viram 3 INSERTs', async () => {
    const [one] = await checkoutRecords();
    const many = Array.from({ length: 120 }, (_, i) => ({ ...one!, id: `id-${String(i).padStart(3, '0')}` }));
    const { db, connect } = pglite();
    const sql: string[] = [];
    const counting: SqlConnect = async (url) => {
      const c = await connect(url);
      return { query: (t, v) => (sql.push(t.trim().split(' ')[0]!), c.query(t, v)), end: c.end };
    };
    expect(await publishDataset(many, 'x', counting)).toBe(120);
    expect(sql).toEqual(['SELECT', 'CREATE', 'INSERT', 'INSERT', 'INSERT']);
    expect((await db.query(`SELECT 1 FROM ${DATASET_TABLE}`)).rows).toHaveLength(120);
    // com a tabela já criada, não tenta criar de novo
    sql.length = 0;
    await publishDataset(many.slice(0, 1), 'x', counting);
    expect(sql).toEqual(['SELECT', 'INSERT']);
  }, 60_000);

  it('0021: os pares saem dos registros do banco e vão para shieldepy_dpo_pairs, sem duplicar', async () => {
    const records = await checkoutRecords();
    const { db, connect } = pglite();
    await publishDataset(records, 'x', connect);
    const read = await readDatasetRecords('x', connect);
    expect(read).toHaveLength(6);
    const pairs = dpoPairs(read);
    expect(pairs).toHaveLength(5); // a corrida deu achado; as outras 5 falhas aguentaram
    expect(await publishDpoPairs(pairs, 'x', connect)).toBe(5);
    expect(await publishDpoPairs(pairs, 'x', connect)).toBe(5);
    const rows = (await db.query<{ kind: string; prompt: string; chosen: string; rejected: string; weak: boolean }>(
      `SELECT kind, prompt, chosen, rejected, (provenance->>'weak')::boolean AS weak FROM ${DPO_TABLE}`
    )).rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.kind === 'diagnostico' && r.weak && r.prompt.startsWith('Analise o seguinte código de rota'))).toBe(true);
    expect(rows[0]!.chosen).toBe('race_condition em stock: stateCheck: stockNeverNegative (Crítico)');
  }, 60_000);

  it('um usuário que só escreve na tabela (sem CREATE no schema) consegue enviar', async () => {
    const records = await checkoutRecords();
    const { db, connect } = pglite();
    await publishDataset(records.slice(0, 1), 'x', connect); // o dono cria a tabela
    await db.exec(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE ROLE shieldepy_writer NOLOGIN;
      GRANT USAGE ON SCHEMA public TO shieldepy_writer;
      GRANT SELECT, INSERT, UPDATE ON ${DATASET_TABLE} TO shieldepy_writer;
      SET ROLE shieldepy_writer;`);
    await expect(db.query('CREATE TABLE outra (x int)')).rejects.toThrow(/permission denied/);
    expect(await publishDataset(records, 'x', connect)).toBe(6);
    await expect(db.query(`DELETE FROM ${DATASET_TABLE}`)).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
    expect((await db.query(`SELECT 1 FROM ${DATASET_TABLE}`)).rows).toHaveLength(6);
  }, 60_000);

  it('o envio do arquivo final: um registro por id, e o filtro por updated_at separa o envio das linhas antigas', async () => {
    const records = await checkoutRecords();
    const { db, connect } = pglite();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-envio-'));
    try {
      await publishDataset(records.slice(0, 2), 'x', connect); // o que já estava no banco e o corpus repete
      const antiga = { ...records[0]!, id: 'linha-antiga' };
      await publishDataset([antiga], 'x', connect); // o que o corpus não tem
      await db.exec(`UPDATE ${DATASET_TABLE} SET created_at = now() - interval '3 days', updated_at = now() - interval '3 days'`);

      const file = path.join(tmp, 'dataset.jsonl');
      fs.writeFileSync(file, datasetJsonl([...records, records[0]!]));
      const { rows } = await db.query<{ t: string }>('SELECT now()::text AS t');
      expect(await publishDatasetFile(file, 'x', connect)).toEqual({ sent: 6, duplicates: 1 });

      const since = (await db.query<{ id: string }>(`SELECT id FROM ${DATASET_TABLE} WHERE updated_at >= $1::timestamptz`, [rows[0]!.t])).rows;
      expect(since.map((r) => r.id).sort()).toEqual(records.map((r) => r.id).sort());
      expect((await db.query(`SELECT 1 FROM ${DATASET_TABLE}`)).rows).toHaveLength(7); // a antiga fica
      // o upsert mantém o created_at: filtrar por ele deixaria de fora o que já existia
      const kept = (await db.query(`SELECT 1 FROM ${DATASET_TABLE} WHERE id = $1 AND created_at < $2::timestamptz`, [records[0]!.id, rows[0]!.t])).rows;
      expect(kept).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it('arquivo com linha fora do formato ou vazio: recusa sem gravar nada', async () => {
    const records = await checkoutRecords();
    const { db, connect } = pglite();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-envio-'));
    try {
      const broken = path.join(tmp, 'quebrado.jsonl');
      fs.writeFileSync(broken, `${datasetJsonl(records)}{ corte no meio\n`);
      await expect(publishDatasetFile(broken, 'x', connect)).rejects.toThrow(/1 linha\(s\).*nada foi enviado/);
      const empty = path.join(tmp, 'vazio.jsonl');
      fs.writeFileSync(empty, '');
      await expect(publishDatasetFile(empty, 'x', connect)).rejects.toThrow(/nenhum registro/);
      expect((await db.query('SELECT to_regclass($1) AS t', [DATASET_TABLE])).rows).toEqual([{ t: null }]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it('o filho do dataset:gerar e do dataset:mutantes roda sem a variável do banco', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-filho-'));
    const before = process.env[DATASET_DB_ENV];
    try {
      // uma CLI falsa que grava o que recebeu: o que importa é o ambiente e os argumentos do processo de verdade
      const cli = path.join(tmp, 'cli.mjs');
      const seen = path.join(tmp, 'visto.json');
      fs.writeFileSync(cli, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify({ url: process.env.${DATASET_DB_ENV} ?? null, path: Boolean(process.env.PATH ?? process.env.Path), argv: process.argv.slice(2) }));\n`);
      process.env[DATASET_DB_ENV] = 'postgres://usuario:segredo@neon.exemplo/treino';
      const r = runChaosChild('alvo', 'parte.jsonl', ['--only-contract'], cli);
      expect(r.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(seen, 'utf8'))).toEqual({ url: null, path: true, argv: ['chaos', 'alvo', '--offline', '--only-contract', '--dataset', 'parte.jsonl'] });
      expect(process.env[DATASET_DB_ENV]).toContain('segredo'); // quem gera não perde a variável
    } finally {
      if (before === undefined) delete process.env[DATASET_DB_ENV];
      else process.env[DATASET_DB_ENV] = before;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('sem a variável e sem --dataset, nada sai; banco fora do ar só avisa, sem a senha no log', async () => {
    const err: string[] = [];
    const io = (env: NodeJS.ProcessEnv) => ({ err: (l: string) => err.push(l), env });
    let called = false;
    const spy: SqlConnect = async () => {
      called = true;
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    };
    const run = { root: '.', graph: {} as never, topology: {} as never, surface: {} as never, state: {} as never, outcomes: undefined };
    await exportChaosDataset(undefined, io({}), run, spy);
    expect(err).toEqual([]);
    expect(called).toBe(false);

    // com resultado: o envio falha, o caos segue
    const records = await checkoutRecords();
    expect(records).toHaveLength(6);
    const { dir, cleanup } = checkoutCopy();
    const lines: string[] = [];
    const code = await runChaosCommand(
      { target: dir, json: false, noRun: false, offline: true },
      { out: () => {}, err: (l) => lines.push(l), env: { [DATASET_DB_ENV]: 'postgres://usuario:segredo@127.0.0.1:1/treino' } },
      () => loadRegistry(defaultWasmDir()),
      async (_root, ids) => ids.map((id) => ({ hypothesisId: id, status: 'passed', durationMs: 1 }))
    ).finally(cleanup);
    expect(code).toBe(0); // o portão é o do caos
    const log = lines.join('\n');
    expect(log).toContain('⚠ dataset: não deu para enviar a 127.0.0.1:1');
    expect(log).not.toContain('segredo');
    expect(dbHost('postgres://u:p@ep-x.neon.tech/db?sslmode=require')).toBe('ep-x.neon.tech');
  }, 60_000);
});
