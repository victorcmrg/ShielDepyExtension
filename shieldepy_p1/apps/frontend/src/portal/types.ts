// Formato das respostas da API (espelham server/auth/*).

export type Role = 'owner' | 'member';
export type MemberStatus = 'active' | 'pending';
export type Permissions = Record<string, boolean>;

/** GET /api/auth/me */
export interface Me {
  email: string;
  companyId: number;
  companyName: string;
  permissions: Permissions;
  isAdmin: boolean;
  role: Role;
}

export interface ProjectSummary {
  id: number;
  companyId: number;
  name: string;
  description: string;
  createdAt: number;
  repoCount: number;
  memberCount: number;
  activeRepos: number;
  lastActivityAt: number | null;
  memberPreview: string[];
}

/** GET /api/workspace */
export interface Workspace {
  me: { email: string; role: Role; isPlatformAdmin: boolean; companyName: string; accessEnabled: boolean };
  projects: ProjectSummary[];
}

export interface Repo {
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
  status: MemberStatus;
  lastLoginAt: number | null;
  addedAt: number;
}

/** GET /api/projects/:id */
export interface ProjectDetail {
  project: { id: number; name: string; description: string; createdAt: number };
  canManage: boolean;
  repos: Repo[];
  members: ProjectMember[];
  candidates: string[];
}

export interface Member {
  id: number | null;
  email: string;
  role: Role;
  status: MemberStatus;
  lastLoginAt: number | null;
  activeDevices: number;
}

/** GET /api/team */
export interface Team {
  me: string;
  members: (Member & { projects: string[] })[];
  projects: { id: number; name: string }[];
}

export interface Device {
  id: number;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** GET /api/account */
export interface Account extends Me {
  hasPassword: boolean;
  devices: Device[];
  teammates: { email: string; status: MemberStatus }[];
}

/** GET /api/admin/overview */
export interface Overview {
  companies: number;
  suspendedCompanies: number;
  users: number;
  pendingInvites: number;
  activeDevices: number;
  aiCompanies: number;
}

/** GET /api/admin/companies */
export interface Company {
  id: number;
  name: string;
  createdAt: number;
  permissions: Permissions;
  memberCount: number;
  pendingCount: number;
}
