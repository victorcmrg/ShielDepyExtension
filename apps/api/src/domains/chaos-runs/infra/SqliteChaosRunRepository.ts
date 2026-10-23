import type { DatabaseSync } from 'node:sqlite';
import type { ChaosRunRepository } from '../application/ports';
import type { RunRecord, RunSummary } from '../domain/run';
import type { ChaosResults } from '../domain/upload';

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

export class SqliteChaosRunRepository implements ChaosRunRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
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
  }

  insert(repoId: number, r: RunRecord, results: ChaosResults): number {
    const info = this.db
      .prepare(
        `INSERT INTO chaos_runs (repo_id, created_at, commit_sha, branch, pr, pr_url, run_url, status, hits, failed, passed, invalid, untested, fail_on, engine, cost_usd, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(repoId, r.createdAt, r.commit, r.branch, r.pr, r.prUrl, r.runUrl, r.status, r.hits, r.failed, r.passed, r.invalid, r.untested, r.failOn, r.engine, r.costUsd, JSON.stringify(results));
    return Number(info.lastInsertRowid);
  }

  prune(repoId: number, keep: number): void {
    this.db
      .prepare(`DELETE FROM chaos_runs WHERE repo_id = ? AND id NOT IN (SELECT id FROM chaos_runs WHERE repo_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`)
      .run(repoId, repoId, keep);
  }

  history(repoId: number, limit: number): RunSummary[] {
    return this.db
      .prepare(`SELECT ${COLUMNS.join(', ')} FROM chaos_runs WHERE repo_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(repoId, limit) as unknown as RunSummary[];
  }

  find(projectId: number, runId: number): { summary: RunSummary; results: ChaosResults } | null {
    const row = this.db
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
}
