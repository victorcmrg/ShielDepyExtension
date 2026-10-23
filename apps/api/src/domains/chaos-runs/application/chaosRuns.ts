// Casos de uso das execuções do caos (V3): tokens de CI por projeto, publicar uma execução e
// ler o histórico. Quem pode fazer cada coisa (dono, membro do projeto) é checado na rota.
import { randomToken, sha256Hex } from '../../../shared/crypto/tokens';
import { CI_TOKEN_PREFIX, looksLikeCiToken, type CiToken } from '../domain/ciToken';
import { HISTORY, MAX_RUNS_PER_REPO, recordOf, type RunSummary } from '../domain/run';
import { parseUpload, type ChaosResults, type ChaosRunUpload } from '../domain/upload';
import type { ChaosRunRepository, CiTokenRepository, ProjectRepos } from './ports';

export type PublishResult = { ok: true; runId: number } | { ok: false; reason: 'repo_not_in_project' };

export class ChaosRunService {
  constructor(
    private readonly runs: ChaosRunRepository,
    private readonly tokens: CiTokenRepository,
    private readonly repos: ProjectRepos,
    private readonly now: () => number = Date.now
  ) {}

  /** Cria um token para o CI publicar neste projeto. O valor só existe aqui: o banco guarda o hash. */
  createCiToken(projectId: number, label: string, createdBy: string): { id: number; token: string } {
    const token = CI_TOKEN_PREFIX + randomToken(32);
    return { id: this.tokens.create(projectId, sha256Hex(token), label, createdBy, this.now()), token };
  }

  listCiTokens(projectId: number): CiToken[] {
    return this.tokens.listActive(projectId);
  }

  revokeCiToken(projectId: number, tokenId: number): boolean {
    return this.tokens.revoke(projectId, tokenId, this.now());
  }

  /** Projeto do token (e marca o uso). Revogado ou desconhecido: null. */
  projectForCiToken(raw: string): number | null {
    if (!looksLikeCiToken(raw)) return null;
    const found = this.tokens.findActive(sha256Hex(raw));
    if (!found) return null;
    this.tokens.markUsed(found.id, this.now());
    return found.projectId;
  }

  /** Valida o upload (UploadError se vier quebrado) e grava, se o repositório for do projeto. */
  publish(projectId: number, raw: unknown): PublishResult {
    const upload = parseUpload(raw);
    const repoId = this.repos.repoIdByRemote(projectId, upload.remote);
    if (!repoId) return { ok: false, reason: 'repo_not_in_project' };
    return { ok: true, runId: this.record(repoId, upload) };
  }

  /** Grava uma execução já validada e aplica a retenção do repositório. */
  record(repoId: number, upload: ChaosRunUpload, createdAt = this.now()): number {
    const id = this.runs.insert(repoId, recordOf(upload, createdAt), upload.results);
    this.runs.prune(repoId, MAX_RUNS_PER_REPO);
    return id;
  }

  /** As execuções mais recentes de um repositório (resumo, sem o resultado). */
  history(repoId: number, limit = HISTORY): RunSummary[] {
    return this.runs.history(repoId, limit);
  }

  /** Uma execução com o resultado completo; null se não existe ou não é deste projeto. */
  getRun(projectId: number, runId: number): { summary: RunSummary; results: ChaosResults } | null {
    return this.runs.find(projectId, runId);
  }
}
