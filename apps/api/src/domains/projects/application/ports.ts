// O que os casos de uso de projetos precisam do banco. A infra implementa (SQLite hoje, Postgres na P1).
import type { Project, ProjectMember, ProjectSummary, RepoView } from '../domain/project';

export interface ProjectRepository {
  get(id: number): Project | null;
  create(companyId: number, name: string, description: string, now: number): Project;
  update(id: number, name: string, description: string): void;
  delete(id: number): void;
  /** O dono vê todos os da empresa; o membro, só os de que participa. */
  listVisible(companyId: number, email: string, isOwner: boolean, activeSince: number): ProjectSummary[];

  isMember(projectId: number, email: string): boolean;
  listMembers(projectId: number): ProjectMember[];
  addMember(projectId: number, email: string, now: number): void;
  removeMember(projectId: number, email: string): boolean;
  /** Nomes dos projetos de cada e-mail da empresa (tela Equipe). */
  projectNamesByEmail(companyId: number): Map<string, string[]>;
  removeFromAllProjects(companyId: number, email: string): void;

  listRepos(projectId: number, activeSince: number): RepoView[];
  hasRepo(projectId: number, remote: string): boolean;
  addRepo(projectId: number, remote: string, now: number): void;
  removeRepo(projectId: number, repoId: number): boolean;
  repoIdByRemote(projectId: number, remote: string): number | null;
  /** O primeiro projeto (por nome) da empresa com este remote em que a pessoa pode trabalhar. */
  findAllowedRepo(companyId: number, remote: string, email: string, isOwner: boolean): { repoId: number; projectId: number; projectName: string } | null;
  recordActivity(repoId: number, email: string, branch: string | null, now: number): void;
}
