// Projetos da empresa. O dono cria projetos, conecta repositórios (identificados pelo remote do
// .git) e escolhe quem trabalha em cada um. A extensão só liga num repositório que esteja num
// projeto da pessoa — e cada vez que liga, registra o uso (quem, qual branch, quando).

export interface Project {
  id: number;
  companyId: number;
  name: string;
  description: string;
  createdAt: number;
}

export interface ProjectSummary extends Project {
  repoCount: number;
  memberCount: number;
  /** Repositórios usados pela extensão nas últimas 24 h. */
  activeRepos: number;
  lastActivityAt: number | null;
  /** Até 4 e-mails pra pilha de avatares do card. */
  memberPreview: string[];
}

export interface RepoView {
  id: number;
  remote: string;
  label: string;
  host: string;
  createdAt: number;
  lastSeen: { email: string; branch: string | null; at: number } | null;
  usersLast24h: number;
}

export interface ProjectMember {
  email: string;
  addedAt: number;
  status: 'active' | 'pending';
  lastLoginAt: number | null;
}

export interface RepoCheck {
  remote: string;
  allowed: boolean;
  project: { id: number; name: string } | null;
}

/** Quem está olhando: a empresa, se é dono, e o e-mail (membros de projeto são por e-mail). */
export interface Viewer {
  companyId: number;
  email: string;
  isOwner: boolean;
}

/** "Em uso" no painel: atividade nas últimas 24 h. */
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A extensão pergunta por no máximo tantos repositórios de uma vez. */
export const MAX_REPOS_PER_CHECK = 10;
const MAX_BRANCH = 120;

/** O projeto é da empresa de quem olha, e quem não é dono só vê o projeto de que participa. */
export function canSee(project: Project, viewer: Viewer, isMember: boolean): boolean {
  return project.companyId === viewer.companyId && (viewer.isOwner || isMember);
}

/** O branch que a extensão manda, limitado (vai para o painel). */
export const cleanBranch = (branch: unknown): string | null => (typeof branch === 'string' ? branch.slice(0, MAX_BRANCH) : null);

/** E-mail de membro sempre em minúsculas (a comparação é por e-mail). */
export const memberKey = (email: string): string => email.toLowerCase();
