// Uma execução do caos guardada no portal: o resumo (a linha do histórico) sai do resultado.
import type { ChaosResults, ChaosRunUpload } from './upload';

/** Guardamos só as últimas execuções de cada repositório. */
export const MAX_RUNS_PER_REPO = 100;
/** Quantas execuções o histórico curto (projeto e página da execução) mostra. */
export const HISTORY = 24;

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

/** O que vai para a linha do histórico, sem id nem repositório. */
export interface RunRecord {
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

export interface RunSummary extends RunRecord {
  id: number;
  repoId: number;
}

export function recordOf(upload: ChaosRunUpload, createdAt: number): RunRecord {
  const r = upload.results;
  const count = (status: string) => r.outcomes.filter((o) => o.status === status).length;
  return {
    createdAt,
    commit: upload.commit,
    branch: upload.branch ?? null,
    pr: upload.pr ?? null,
    prUrl: upload.prUrl ?? null,
    runUrl: upload.runUrl ?? null,
    status: runStatus(r),
    hits: r.hits,
    failed: count('failed'),
    passed: count('passed'),
    invalid: count('invalid'),
    untested: r.untested.length,
    failOn: String(r.failOn ?? ''),
    engine: String(r.engine ?? 'offline'),
    costUsd: typeof r.cost?.usd === 'number' ? r.cost.usd : 0,
  };
}
