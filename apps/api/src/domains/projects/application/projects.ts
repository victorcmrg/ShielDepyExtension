// Casos de uso de projetos: CRUD, repositórios, membros e o "posso usar este repositório?" da
// extensão. Quem pode fazer cada coisa (dono) é checado na rota; quem pode ver, aqui (canSee).
import { ACTIVE_WINDOW_MS, MAX_REPOS_PER_CHECK, canSee, cleanBranch, memberKey, type Project, type ProjectMember, type ProjectSummary, type RepoCheck, type RepoView, type Viewer } from '../domain/project';
import { normalizeRemote } from '../domain/remote';
import type { ProjectRepository } from './ports';

export type AddRepoResult = { ok: true; remote: string } | { ok: false; reason: 'invalid' | 'duplicate' };

export class ProjectService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly now: () => number = Date.now
  ) {}

  get(id: number): Project | null {
    return this.repo.get(id);
  }

  /** O projeto, se quem olha pode vê-lo; senão null (a rota responde 404, sem dizer que existe). */
  visibleTo(id: number, viewer: Viewer): Project | null {
    const p = this.repo.get(id);
    return p && canSee(p, viewer, this.repo.isMember(id, memberKey(viewer.email))) ? p : null;
  }

  create(companyId: number, name: string, description: string): Project {
    return this.repo.create(companyId, name, description, this.now());
  }

  update(id: number, name: string, description: string): void {
    this.repo.update(id, name, description);
  }

  delete(id: number): void {
    this.repo.delete(id);
  }

  listFor(companyId: number, email: string, isOwner: boolean): ProjectSummary[] {
    return this.repo.listVisible(companyId, memberKey(email), isOwner, this.now() - ACTIVE_WINDOW_MS);
  }

  isMember(projectId: number, email: string): boolean {
    return this.repo.isMember(projectId, memberKey(email));
  }

  listMembers(projectId: number): ProjectMember[] {
    return this.repo.listMembers(projectId);
  }

  addMember(projectId: number, email: string): void {
    this.repo.addMember(projectId, memberKey(email), this.now());
  }

  removeMember(projectId: number, email: string): boolean {
    return this.repo.removeMember(projectId, memberKey(email));
  }

  projectNamesByEmail(companyId: number): Map<string, string[]> {
    return this.repo.projectNamesByEmail(companyId);
  }

  /** Tirar alguém da empresa também tira dos projetos dela. */
  removeFromAllProjects(companyId: number, email: string): void {
    this.repo.removeFromAllProjects(companyId, memberKey(email));
  }

  listRepos(projectId: number): RepoView[] {
    return this.repo.listRepos(projectId, this.now() - ACTIVE_WINDOW_MS);
  }

  /** Conecta um repositório. Devolve o remote normalizado, ou um motivo de recusa. */
  addRepo(projectId: number, url: string): AddRepoResult {
    const remote = normalizeRemote(url);
    if (!remote) return { ok: false, reason: 'invalid' };
    if (this.repo.hasRepo(projectId, remote)) return { ok: false, reason: 'duplicate' };
    this.repo.addRepo(projectId, remote, this.now());
    return { ok: true, remote };
  }

  removeRepo(projectId: number, repoId: number): boolean {
    return this.repo.removeRepo(projectId, repoId);
  }

  /** Repositório do projeto com este remote (comparado normalizado), ou null. */
  repoIdByRemote(projectId: number, remote: string): number | null {
    const normalized = normalizeRemote(remote);
    return normalized ? this.repo.repoIdByRemote(projectId, normalized) : null;
  }

  /**
   * Pedido da extensão: "posso trabalhar nestes repositórios?". Liberado se o remote estiver num
   * projeto da empresa em que a pessoa participa (o dono participa de todos). Quando liberado,
   * registra o uso — é isso que alimenta "em uso por fulano há 3 min" no painel.
   */
  checkRepos(viewer: Viewer, repos: Array<{ remote: string; branch?: string | null }>): RepoCheck[] {
    const now = this.now();
    const email = memberKey(viewer.email);
    return repos.slice(0, MAX_REPOS_PER_CHECK).map(({ remote: raw, branch }) => {
      const remote = normalizeRemote(raw);
      if (!remote) return { remote: raw, allowed: false, project: null };
      const match = this.repo.findAllowedRepo(viewer.companyId, remote, email, viewer.isOwner);
      if (!match) return { remote, allowed: false, project: null };
      this.repo.recordActivity(match.repoId, email, cleanBranch(branch), now);
      return { remote, allowed: true, project: { id: match.projectId, name: match.projectName } };
    });
  }
}
