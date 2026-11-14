// As execuções do caos no Postgres (tabela chaos_runs, de shared/db/schema.ts). O resultado
// completo fica em `payload` (jsonb) e volta como objeto.
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { Db } from '../../../shared/db/postgres';
import { chaosRuns, projectRepos } from '../../../shared/db/schema';
import type { ChaosRunRepository } from '../application/ports';
import type { RunRecord, RunSummary } from '../domain/run';
import type { ChaosResults } from '../domain/upload';

const SUMMARY = {
  id: chaosRuns.id,
  repoId: chaosRuns.repoId,
  createdAt: chaosRuns.createdAt,
  commit: chaosRuns.commitSha,
  branch: chaosRuns.branch,
  pr: chaosRuns.pr,
  prUrl: chaosRuns.prUrl,
  runUrl: chaosRuns.runUrl,
  status: chaosRuns.status,
  hits: chaosRuns.hits,
  failed: chaosRuns.failed,
  passed: chaosRuns.passed,
  invalid: chaosRuns.invalid,
  untested: chaosRuns.untested,
  failOn: chaosRuns.failOn,
  engine: chaosRuns.engine,
  costUsd: chaosRuns.costUsd,
};

export class DrizzleChaosRunRepository implements ChaosRunRepository {
  constructor(private readonly db: Db) {}

  async insert(repoId: number, { commit, ...r }: RunRecord, results: ChaosResults): Promise<number> {
    const [row] = await this.db
      .insert(chaosRuns)
      .values({ ...r, repoId, commitSha: commit, payload: results })
      .returning({ id: chaosRuns.id });
    return row!.id;
  }

  async prune(repoId: number, keep: number): Promise<void> {
    const newest = this.db.select({ id: chaosRuns.id }).from(chaosRuns).where(eq(chaosRuns.repoId, repoId)).orderBy(desc(chaosRuns.createdAt), desc(chaosRuns.id)).limit(keep);
    await this.db.delete(chaosRuns).where(and(eq(chaosRuns.repoId, repoId), notInArray(chaosRuns.id, newest)));
  }

  async history(repoId: number, limit: number): Promise<RunSummary[]> {
    const rows = await this.db.select(SUMMARY).from(chaosRuns).where(eq(chaosRuns.repoId, repoId)).orderBy(desc(chaosRuns.createdAt), desc(chaosRuns.id)).limit(limit);
    return rows as RunSummary[];
  }

  async find(projectId: number, runId: number): Promise<{ summary: RunSummary; results: ChaosResults } | null> {
    const [row] = await this.db
      .select({ ...SUMMARY, payload: chaosRuns.payload })
      .from(chaosRuns)
      .innerJoin(projectRepos, eq(projectRepos.id, chaosRuns.repoId))
      .where(and(eq(chaosRuns.id, runId), eq(projectRepos.projectId, projectId)));
    if (!row) return null;
    const { payload, ...summary } = row;
    return { summary: summary as RunSummary, results: payload as ChaosResults };
  }
}
