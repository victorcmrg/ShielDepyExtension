// O dataset de treino no fim do `shieldepy chaos` (D2, decisões 0016 e 0020): um registro por
// hipótese que rodou, acrescentado ao `--dataset <arq.jsonl>` e/ou enviado ao banco do treino quando
// a variável SHIELDEPY_DATASET_DATABASE_URL existe. Aqui fica o que lê o disco e o git (a fonte, a
// licença e o código da cadeia); o registro em si é a função pura `buildDatasetRecords` do agent.
// Sem a variável, nada vai para a rede: o remote vem da config local do git.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { canonicalJson, toFileId, type AttackSurface, type CodeGraph, type TopologyGraph } from '@shieldepy/core';
import {
  buildDatasetRecords,
  datasetJsonl,
  routeCode,
  type ChaosOutcome,
  type ChaosStateType,
  type DatasetRecord,
  type DatasetSource,
  type DatasetVariant,
} from '@shieldepy/agent/chaos';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING'];

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** O remote sem usuário e senha (`https://token@github.com/...` não pode ir para o dataset). */
export function publicRemote(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    return u.toString();
  } catch {
    return url; // `git@github.com:dono/repo.git` não é URL; não leva segredo
  }
}

/** O `license` do `package.json` da pasta, senão a primeira linha do `LICENSE`; sobe até a raiz do repositório. */
export function findLicense(dirs: string[]): DatasetSource['license'] {
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { license?: unknown };
      const value = typeof pkg.license === 'string' ? pkg.license : (pkg.license as { type?: unknown } | undefined)?.type;
      if (typeof value === 'string' && value.trim()) return { value: value.trim(), from: 'package.json' };
    } catch {
      // sem package.json legível
    }
    for (const name of LICENSE_FILES) {
      const file = path.join(dir, name);
      if (!existsSync(file)) continue;
      const first = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).find((l) => l.length > 0);
      if (first) return { value: first, from: 'LICENSE' };
    }
  }
  return undefined;
}

/** `-fixed` no nome da pasta é a versão corrigida de um exemplo; o resto é o original (os mutantes saem da D4). */
export function variantOf(project: string): DatasetVariant {
  return project.endsWith('-fixed') ? 'fixed' : 'original';
}

export function datasetSource(root: string): DatasetSource {
  const project = path.basename(root);
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const dirs = [root, ...(top && path.resolve(top) !== path.resolve(root) ? [top] : [])];
  const license = findLicense(dirs);
  return {
    project,
    ...(remote && { repo: publicRemote(remote) }),
    ...(commit && { commit }),
    ...(top && { path: prefix ? prefix.replace(/\/$/, '') : '.' }),
    ...(license && { license }),
    variant: variantOf(project),
  };
}

export interface ChaosRunForDataset {
  root: string;
  graph: CodeGraph;
  topology: TopologyGraph;
  surface: AttackSurface;
  state: ChaosStateType;
  /** Sem resultado (--no-run, erro de ambiente) não há rótulo, e nada sai. */
  outcomes?: ChaosOutcome[];
}

/** Os registros de uma execução do caos (um por hipótese que rodou). */
export function chaosDatasetRecords(run: ChaosRunForDataset & { outcomes: ChaosOutcome[] }): DatasetRecord[] {
  const { root, state } = run;
  const code = routeCode(run.topology.routes, run.graph, toFileId(root), (id) => {
    try {
      return readFileSync(id, 'utf8');
    } catch {
      return undefined;
    }
  });
  return buildDatasetRecords({
    source: datasetSource(root),
    surface: run.surface,
    code,
    engine: state.engine,
    model: state.completions.find((c) => c.model)?.model,
    hypotheses: state.hypotheses,
    rejected: state.rejected,
    specs: state.specs,
    errors: state.errors,
    files: state.files,
    outcomes: run.outcomes,
  });
}

/**
 * O banco do treino (decisão 0020): a URL do Postgres da equipe de IA (o Neon dela). Só existe nas
 * nossas máquinas e no nosso CI: o registro leva o código das rotas, e o de um cliente nunca pode
 * sair da máquina dele (0008, 0016). Sem a variável, nada vai para a rede.
 */
export const DATASET_DB_ENV = 'SHIELDEPY_DATASET_DATABASE_URL';
export const DATASET_TABLE = 'shieldepy_dataset';

export const DATASET_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${DATASET_TABLE} (
  id text PRIMARY KEY,
  schema_version integer NOT NULL,
  project text NOT NULL,
  variant text NOT NULL,
  hypothesis_id text NOT NULL,
  outcome text NOT NULL,
  control text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

/** O pedaço do cliente do `pg` que o envio usa (os testes injetam um falso). */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}
export type SqlConnect = (url: string) => Promise<SqlClient>;

/** O `pg` só carrega quando há para onde enviar. */
export const pgConnect: SqlConnect = async (url) => {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
  await client.connect();
  return client;
};

const BATCH = 50;

/** Grava os registros por upsert no `id`: rodar de novo atualiza, não duplica. Devolve quantos foram. */
export async function publishDataset(records: DatasetRecord[], url: string, connect: SqlConnect = pgConnect): Promise<number> {
  if (records.length === 0) return 0;
  const client = await connect(url);
  try {
    await client.query(DATASET_TABLE_SQL);
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const values: unknown[] = [];
      const rows = batch.map((r) => {
        const n = values.length;
        values.push(r.id, r.schemaVersion, r.source.project, r.source.variant, r.hypothesis.id, r.result.outcome, r.result.control, canonicalJson(r));
        return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}::jsonb)`;
      });
      await client.query(
        `INSERT INTO ${DATASET_TABLE} (id, schema_version, project, variant, hypothesis_id, outcome, control, record) VALUES ${rows.join(', ')}
         ON CONFLICT (id) DO UPDATE SET schema_version = EXCLUDED.schema_version, outcome = EXCLUDED.outcome, control = EXCLUDED.control, record = EXCLUDED.record, updated_at = now()`,
        values
      );
    }
    return records.length;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** O host da URL, para o log (a URL tem a senha). */
export function dbHost(url: string): string {
  try {
    return new URL(url).host || 'banco';
  } catch {
    return 'banco';
  }
}

/**
 * O fim do `shieldepy chaos`: com `--dataset <arq>`, acrescenta ao JSONL; com a variável
 * `SHIELDEPY_DATASET_DATABASE_URL`, envia ao banco do treino. Falha no envio só avisa: o portão do
 * caos não muda por causa do dataset.
 */
export async function exportChaosDataset(
  file: string | undefined,
  io: { err: (line: string) => void; env: NodeJS.ProcessEnv },
  run: ChaosRunForDataset,
  connect: SqlConnect = pgConnect
): Promise<void> {
  const url = io.env[DATASET_DB_ENV]?.trim() || undefined;
  if (!file && !url) return;
  const records = run.outcomes ? chaosDatasetRecords({ ...run, outcomes: run.outcomes }) : [];
  if (records.length === 0) {
    io.err(`ℹ dataset: nada a ${file ? `acrescentar a ${file}` : 'enviar'} (sem resultado de teste)`);
    return;
  }
  if (file) {
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    await appendFile(file, datasetJsonl(records), 'utf8');
    io.err(`✓ ${records.length} registro(s) do dataset acrescentado(s) a ${file}`);
  }
  if (url) {
    try {
      const n = await publishDataset(records, url, connect);
      io.err(`✓ ${n} registro(s) do dataset enviado(s) a ${dbHost(url)} (tabela ${DATASET_TABLE})`);
    } catch (err) {
      io.err(`⚠ dataset: não deu para enviar a ${dbHost(url)}: ${err instanceof Error ? err.message : String(err)} (o resultado do caos não muda)`);
    }
  }
}
