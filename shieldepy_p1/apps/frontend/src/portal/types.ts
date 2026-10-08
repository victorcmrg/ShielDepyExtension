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

// --- caos no CI (V3): espelham server/auth/chaosRuns.ts e o ChaosResults do @shieldepy/agent ---------

/** O resumo de uma execução numa palavra (a cor no portal). */
export type RunStatus = 'blocked' | 'passed' | 'below_gate' | 'nothing' | 'not_run' | 'error' | 'invalid';

export interface RunSummary {
  id: number;
  repoId: number;
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

export interface RepoRef {
  id: number;
  label: string;
  remote: string;
}

/** GET /api/projects/:id/chaos */
export interface ProjectChaos {
  repos: { repo: RepoRef; latest: RunSummary | null; history: RunSummary[] }[];
  canManage: boolean;
}

export interface CiToken {
  id: number;
  label: string;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface SurfaceOperation {
  order: number;
  kind: 'db_read' | 'db_write' | 'db_tx' | 'db_unknown' | 'api_call';
  target: string;
  via: string;
  operation?: string;
  lock?: true;
  timeout?: string;
  at: string;
  in: string;
  confidence: 'proven' | 'heuristic';
}

export interface SurfaceRoute {
  id: string;
  method: string;
  path: string;
  at: string;
  handlers: string[];
  operations: SurfaceOperation[];
  tags: { tag: string; targets?: string[] }[];
  collisions: string[];
  confidence: 'proven' | 'heuristic';
  truncated?: true;
}

export interface ChaosOutcome {
  hypothesisId: string;
  routeId: string;
  failure: string;
  target: string;
  status: 'passed' | 'failed' | 'invalid';
  severity?: string;
  message?: string;
  durationMs: number;
  testFile: string;
}

export interface ChaosResultsView {
  project: string;
  topologyHash: string;
  engine: string;
  ran: boolean;
  runError?: string;
  failOn: string;
  hits: number;
  scope?: { base: string; commit: string; all?: string; tested: string[]; affected: { id: string; why: string[] }[]; untouched: string[] };
  outcomes: ChaosOutcome[];
  untested: { id: string; routeId: string; failure: string; target: string; reason: string }[];
  cost: { calls: number; inputTokens: number; outputTokens: number; usd: number };
  surface?: { routes: SurfaceRoute[] };
}

/** GET /api/projects/:id/chaos/runs/:runId */
export interface ChaosRunDetail {
  project: { id: number; name: string };
  repo: RepoRef | null;
  run: RunSummary;
  results: ChaosResultsView;
  history: RunSummary[];
}
