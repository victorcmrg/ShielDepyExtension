// O que os casos de uso de projetos precisam do banco. A infra implementa (Postgres com Drizzle).
import type { Project, ProjectMember, ProjectSummary, RepoView } from '../domain/project';

export interface ProjectRepository {
  get(id: number): Promise<Project | null>;
  create(companyId: number, name: string, description: string, now: number): Promise<Project>;
  update(id: number, name: string, description: string): Promise<void>;
  delete(id: number): Promise<void>;
  /** O dono vê todos os da empresa; o membro, só os de que participa. */
  listVisible(companyId: number, email: string, isOwner: boolean, activeSince: number): Promise<ProjectSummary[]>;

  isMember(projectId: number, email: string): Promise<boolean>;
  listMembers(projectId: number): Promise<ProjectMember[]>;
  addMember(projectId: number, email: string, now: number): Promise<void>;
  removeMember(projectId: number, email: string): Promise<boolean>;
  /** Nomes dos projetos de cada e-mail da empresa (tela Equipe). */
  projectNamesByEmail(companyId: number): Promise<Map<string, string[]>>;
  removeFromAllProjects(companyId: number, email: string): Promise<void>;

  listRepos(projectId: number, activeSince: number): Promise<RepoView[]>;
  hasRepo(projectId: number, remote: string): Promise<boolean>;
  addRepo(projectId: number, remote: string, now: number): Promise<void>;
  removeRepo(projectId: number, repoId: number): Promise<boolean>;
  repoIdByRemote(projectId: number, remote: string): Promise<number | null>;
  /** O primeiro projeto (por nome) da empresa com este remote em que a pessoa pode trabalhar. */
  findAllowedRepo(companyId: number, remote: string, email: string, isOwner: boolean): Promise<{ repoId: number; projectId: number; projectName: string } | null>;
  recordActivity(repoId: number, email: string, branch: string | null, now: number): Promise<void>;
}
