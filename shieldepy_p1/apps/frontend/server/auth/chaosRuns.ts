// Execuções do caos enviadas pelo CI (V3): tokens de CI por projeto e o histórico por repositório.
// O payload é o `ChaosRunUpload` do `shieldepy publish` — só fatos (rotas, operações, tabelas, hosts,
// arquivo:linha), nenhum código-fonte. Guardamos as últimas MAX_RUNS_PER_REPO execuções por repositório.
import type { ChaosResults, ChaosRunUpload } from '@shieldepy/agent/chaos';
import { db } from './db';
import { normalizeRemote } from './remotes';
import { randomToken, sha256Hex } from './tokens';

export const MAX_RUNS_PER_REPO = 100;
const HISTORY = 24;

db.exec(`
  CREATE TABLE IF NOT EXISTS project_ci_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    created_by   TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS chaos_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id       INTEGER NOT NULL REFERENCES project_repos(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    commit_sha    TEXT NOT NULL,
    branch        TEXT,
    pr            INTEGER,
    pr_url        TEXT,
    run_url       TEXT,
    status        TEXT NOT NULL,
    hits          INTEGER NOT NULL,
    failed        INTEGER NOT NULL,
    passed        INTEGER NOT NULL,
    invalid       INTEGER NOT NULL,
    untested      INTEGER NOT NULL,
    fail_on       TEXT NOT NULL,
    engine        TEXT NOT NULL,
    cost_usd      REAL NOT NULL,
    payload       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chaos_runs_repo ON chaos_runs (repo_id, created_at DESC);
`);

// --- tokens de CI -------------------------------------------------------------------

export interface CiToken {
  id: number;
  label: string;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Cria um token para o CI publicar neste projeto. O valor só existe aqui: o banco guarda o hash. */
export function createCiToken(projectId: number, label: string, createdBy: string): { id: number; token: string } {
  const token = `sdci_${randomToken(32)}`;
  const info = db
    .prepare(`INSERT INTO project_ci_tokens (project_id, token_hash, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(projectId, sha256Hex(token), label, createdBy, Date.now());
  return { id: Number(info.lastInsertRowid), token };
}

export function listCiTokens(projectId: number): CiToken[] {
  return db
    .prepare(
      `SELECT id, label, created_by as createdBy, created_at as createdAt, last_used_at as lastUsedAt
       FROM project_ci_tokens WHERE project_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`
    )
    .all(projectId) as unknown as CiToken[];
}

export function revokeCiToken(projectId: number, tokenId: number): boolean {
  return Number(db.prepare(`UPDATE project_ci_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL`).run(Date.now(), tokenId, projectId).changes) > 0;
}

/** Projeto do token (e marca o uso). Revogado ou desconhecido: null. */
export function projectForCiToken(raw: string): number | null {
  if (!raw.startsWith('sdci_')) return null;
  const row = db.prepare(`SELECT id, project_id as projectId FROM project_ci_tokens WHERE token_hash = ? AND revoked_at IS NULL`).get(sha256Hex(raw)) as
    | { id: number; projectId: number }
    | undefined;
  if (!row) return null;
  db.prepare(`UPDATE project_ci_tokens SET last_used_at = ? WHERE id = ?`).run(Date.now(), row.id);
  return row.projectId;
}

// --- validação do que o CI manda ---------------------------------------------------------

export class UploadError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
/** Só http(s): o link vira <a href> no portal (nada de `javascript:`). */
const httpUrl = (v: unknown): string | undefined => {
  const s = str(v, 500);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** Confere a forma do upload antes de gravar; o que for opcional e vier errado, sai. */
export function parseUpload(raw: unknown): ChaosRunUpload {
  if (!isObj(raw) || raw.version !== 1) throw new UploadError('payload inválido (esperado version: 1)');
  const remote = str(raw.remote, 300);
  const commit = str(raw.commit, 80);
  if (!remote || !commit) throw new UploadError('faltam o remote e o commit');
  const r = raw.results;
  if (!isObj(r) || r.version !== 1 || !Array.isArray(r.outcomes) || !Array.isArray(r.untested) || typeof r.hits !== 'number') {
    throw new UploadError('resultado do caos inválido (gere com o shieldepy chaos desta versão)');
  }
  const pr = typeof raw.pr === 'number' && Number.isInteger(raw.pr) && raw.pr > 0 ? raw.pr : undefined;
  const branch = str(raw.branch, 200);
  const prUrl = httpUrl(raw.prUrl);
  const runUrl = httpUrl(raw.runUrl);
  return {
    version: 1,
    remote,
    commit,
    ...(branch && { branch }),
    ...(pr && { pr }),
    ...(prUrl && { prUrl }),
    ...(runUrl && { runUrl }),
    results: r as unknown as ChaosResults,
  };
}

// --- execuções ----------------------------------------------------------------------------

/** O resumo de uma execução numa palavra (a cor no portal). */
export type RunStatus = 'blocked' | 'passed' | 'below_gate' | 'nothing' | 'not_run' | 'error' | 'invalid';

export function runStatus(r: ChaosResults): RunStatus {
  if (r.runError) return 'error';
  if (r.scope && r.scope.tested.length === 0) return 'nothing';
  if (!r.ran) return 'not_run';
  if (r.hits > 0) return 'blocked';
  if (r.outcomes.length > 0 && r.outcomes.every((o) => o.status === 'invalid')) return 'invalid';
  if (r.outcomes.some((o) => o.status === 'failed')) return 'below_gate';
  return 'passed';
}

export interface RunSummary {
  id: number;
  repoId: number;
  createdAt: number;
  commit: string;
  branch: string | null;
  pr: number | null;
  prUrl: string | null;
  runUrl: string | null;
  status: RunStatus;
  hits: number;
  failed: number;
  passed: number;
  invalid: number;
  untested: number;
  failOn: string;
  engine: string;
  costUsd: number;
}

const COLUMNS = [
  'id',
  'repo_id as repoId',
  'created_at as createdAt',
  'commit_sha as "commit"',
  'branch',
  'pr',
  'pr_url as prUrl',
  'run_url as runUrl',
  'status',
  'hits',
  'failed',
  'passed',
  'invalid',
  'untested',
  'fail_on as failOn',
  'engine',
  'cost_usd as costUsd',
];
const SUMMARY_COLUMNS = COLUMNS.join(', ');

/** Repositório do projeto com este remote (comparado normalizado), ou null. */
export function repoInProject(projectId: number, remote: string): number | null {
  const normalized = normalizeRemote(remote);
  if (!normalized) return null;
  const row = db.prepare(`SELECT id FROM project_repos WHERE project_id = ? AND remote = ?`).get(projectId, normalized) as { id: number } | undefined;
  return row?.id ?? null;
}

export function insertRun(repoId: number, upload: ChaosRunUpload, now = Date.now()): number {
  const r = upload.results;
  const count = (status: string) => r.outcomes.filter((o) => o.status === status).length;
  const info = db
    .prepare(
      `INSERT INTO chaos_runs (repo_id, created_at, commit_sha, branch, pr, pr_url, run_url, status, hits, failed, passed, invalid, untested, fail_on, engine, cost_usd, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      repoId,
      now,
      upload.commit,
      upload.branch ?? null,
      upload.pr ?? null,
      upload.prUrl ?? null,
      upload.runUrl ?? null,
      runStatus(r),
      r.hits,
      count('failed'),
      count('passed'),
      count('invalid'),
      r.untested.length,
      String(r.failOn ?? ''),
      String(r.engine ?? 'offline'),
      typeof r.cost?.usd === 'number' ? r.cost.usd : 0,
      JSON.stringify(r)
    );
  // retenção: só as últimas MAX_RUNS_PER_REPO deste repositório
  db.prepare(
    `DELETE FROM chaos_runs WHERE repo_id = ? AND id NOT IN (SELECT id FROM chaos_runs WHERE repo_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`
  ).run(repoId, repoId, MAX_RUNS_PER_REPO);
  return Number(info.lastInsertRowid);
}

/** As execuções mais recentes de um repositório (resumo, sem o payload). */
export function repoHistory(repoId: number, limit = HISTORY): RunSummary[] {
  return db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM chaos_runs WHERE repo_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(repoId, limit) as unknown as RunSummary[];
}

/** Uma execução com o resultado completo; null se não existe ou não é deste projeto. */
export function getRun(projectId: number, runId: number): { summary: RunSummary; results: ChaosResults } | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS.map((c) => 'cr.' + c).join(', ')}, cr.payload as payload
       FROM chaos_runs cr JOIN project_repos pr ON pr.id = cr.repo_id
       WHERE cr.id = ? AND pr.project_id = ?`
    )
    .get(runId, projectId) as (RunSummary & { payload: string }) | undefined;
  if (!row) return null;
  const { payload, ...summary } = row;
  return { summary, results: JSON.parse(payload) as ChaosResults };
}
