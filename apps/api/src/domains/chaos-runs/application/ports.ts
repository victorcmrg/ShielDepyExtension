// O que os casos de uso precisam do mundo de fora. A infra implementa (SQLite hoje, Postgres na P1).
import type { CiToken } from '../domain/ciToken';
import type { RunRecord, RunSummary } from '../domain/run';
import type { ChaosResults } from '../domain/upload';

export interface ChaosRunRepository {
  insert(repoId: number, record: RunRecord, results: ChaosResults): number;
  /** Apaga as execuções do repositório além das `keep` mais recentes. */
  prune(repoId: number, keep: number): void;
  history(repoId: number, limit: number): RunSummary[];
  /** A execução com o resultado completo, só se o repositório for deste projeto. */
  find(projectId: number, runId: number): { summary: RunSummary; results: ChaosResults } | null;
}

export interface CiTokenRepository {
  create(projectId: number, tokenHash: string, label: string, createdBy: string, now: number): number;
  listActive(projectId: number): CiToken[];
  revoke(projectId: number, tokenId: number, now: number): boolean;
  findActive(tokenHash: string): { id: number; projectId: number } | null;
  markUsed(tokenId: number, now: number): void;
}

/** Do contexto de projetos: o repositório do projeto com este remote (comparado normalizado). */
export interface ProjectRepos {
  repoIdByRemote(projectId: number, remote: string): number | null;
}
