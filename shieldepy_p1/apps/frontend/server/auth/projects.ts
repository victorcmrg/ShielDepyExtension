// Projetos da empresa. O dono cria projetos, conecta repositórios (identificados pelo remote do
// .git) e escolhe quem trabalha em cada um. A extensão só liga num repositório que esteja num
// projeto da pessoa — e cada vez que liga, registra o uso (quem, qual branch, quando).
import { db } from './db';
import { normalizeRemote, remoteLabel } from './remotes';

export interface ProjectRow {
  id: number;
  companyId: number;
  name: string;
  description: string;
  createdAt: number;
}

export interface ProjectSummary extends ProjectRow {
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

const DAY = 24 * 60 * 60 * 1000;

export function getProject(id: number): ProjectRow | null {
  const row = db
    .prepare(`SELECT id, company_id as companyId, name, description, created_at as createdAt FROM projects WHERE id = ?`)
    .get(id) as ProjectRow | undefined;
  return row ?? null;
}

export function createProject(companyId: number, name: string, description: string): ProjectRow {
  const now = Date.now();
  const result = db
    .prepare(`INSERT INTO projects (company_id, name, description, created_at) VALUES (?, ?, ?, ?)`)
    .run(companyId, name, description, now);
  return { id: Number(result.lastInsertRowid), companyId, name, description, createdAt: now };
}

export function updateProject(id: number, name: string, description: string): void {
  db.prepare(`UPDATE projects SET name = ?, description = ? WHERE id = ?`).run(name, description, id);
}

export function deleteProject(id: number): void {
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

/** Projetos visíveis: o dono vê todos os da empresa; o membro, só os que participa. */
export function listProjectsFor(companyId: number, email: string, isOwner: boolean): ProjectSummary[] {
  const rows = (
    isOwner
      ? db.prepare(`SELECT id, company_id as companyId, name, description, created_at as createdAt FROM projects WHERE company_id = ? ORDER BY name COLLATE NOCASE`).all(companyId)
      : db
          .prepare(
            `SELECT p.id as id, p.company_id as companyId, p.name as name, p.description as description, p.created_at as createdAt
             FROM projects p JOIN project_members m ON m.project_id = p.id
             WHERE p.company_id = ? AND m.email = ? ORDER BY p.name COLLATE NOCASE`
          )
          .all(companyId, email.toLowerCase())
  ) as unknown as ProjectRow[];

  const since = Date.now() - DAY;
  return rows.map((p) => {
    const one = (sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as Record<string, number | null>;
    const members = db.prepare(`SELECT email FROM project_members WHERE project_id = ? ORDER BY added_at`).all(p.id) as { email: string }[];
    return {
      ...p,
      repoCount: Number(one(`SELECT COUNT(*) as n FROM project_repos WHERE project_id = ?`, p.id).n),
      memberCount: members.length,
      activeRepos: Number(
        one(
          `SELECT COUNT(DISTINCT r.id) as n FROM project_repos r JOIN repo_activity a ON a.repo_id = r.id
           WHERE r.project_id = ? AND a.last_seen_at > ?`,
          p.id,
          since
        ).n
      ),
      lastActivityAt:
        (one(`SELECT MAX(a.last_seen_at) as at FROM project_repos r JOIN repo_activity a ON a.repo_id = r.id WHERE r.project_id = ?`, p.id)
          .at as number | null) ?? null,
      memberPreview: members.slice(0, 4).map((m) => m.email),
    };
  });
}

export function isProjectMember(projectId: number, email: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND email = ?`).get(projectId, email.toLowerCase()));
}

export function listRepos(projectId: number): RepoView[] {
  const repos = db
    .prepare(`SELECT id, remote, created_at as createdAt FROM project_repos WHERE project_id = ? ORDER BY created_at`)
    .all(projectId) as { id: number; remote: string; createdAt: number }[];
  const since = Date.now() - DAY;
  return repos.map((r) => {
    const last = db
      .prepare(`SELECT email, branch, last_seen_at as at FROM repo_activity WHERE repo_id = ? ORDER BY last_seen_at DESC LIMIT 1`)
      .get(r.id) as { email: string; branch: string | null; at: number } | undefined;
    const recent = db.prepare(`SELECT COUNT(*) as n FROM repo_activity WHERE repo_id = ? AND last_seen_at > ?`).get(r.id, since) as { n: number };
    return {
      id: r.id,
      remote: r.remote,
      label: remoteLabel(r.remote),
      host: r.remote.split('/')[0]!,
      createdAt: r.createdAt,
      lastSeen: last ?? null,
      usersLast24h: Number(recent.n),
    };
  });
}

/** Conecta um repositório. Devolve o remote normalizado, ou um motivo de recusa. */
export function addRepo(projectId: number, url: string): { ok: true; remote: string } | { ok: false; reason: 'invalid' | 'duplicate' } {
  const remote = normalizeRemote(url);
  if (!remote) return { ok: false, reason: 'invalid' };
  if (db.prepare(`SELECT 1 FROM project_repos WHERE project_id = ? AND remote = ?`).get(projectId, remote)) return { ok: false, reason: 'duplicate' };
  db.prepare(`INSERT INTO project_repos (project_id, remote, created_at) VALUES (?, ?, ?)`).run(projectId, remote, Date.now());
  return { ok: true, remote };
}

export function removeRepo(projectId: number, repoId: number): boolean {
  return Number(db.prepare(`DELETE FROM project_repos WHERE id = ? AND project_id = ?`).run(repoId, projectId).changes) > 0;
}

export function listProjectMembers(projectId: number): { email: string; addedAt: number; status: 'active' | 'pending'; lastLoginAt: number | null }[] {
  return (
    db
      .prepare(
        `SELECT m.email as email, m.added_at as addedAt, u.last_login_at as lastLoginAt, u.id as userId
         FROM project_members m LEFT JOIN users u ON u.email = m.email
         WHERE m.project_id = ? ORDER BY m.added_at`
      )
      .all(projectId) as { email: string; addedAt: number; lastLoginAt: number | null; userId: number | null }[]
  ).map((m) => ({ email: m.email, addedAt: m.addedAt, status: m.userId ? 'active' : 'pending', lastLoginAt: m.lastLoginAt }));
}

export function addProjectMember(projectId: number, email: string): void {
  db.prepare(`INSERT INTO project_members (project_id, email, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).run(
    projectId,
    email.toLowerCase(),
    Date.now()
  );
}

export function removeProjectMember(projectId: number, email: string): boolean {
  return Number(db.prepare(`DELETE FROM project_members WHERE project_id = ? AND email = ?`).run(projectId, email.toLowerCase()).changes) > 0;
}

/** Nomes dos projetos de cada e-mail da empresa (tela Equipe). */
export function projectNamesByEmail(companyId: number): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT m.email as email, p.name as name FROM project_members m JOIN projects p ON p.id = m.project_id
       WHERE p.company_id = ? ORDER BY p.name COLLATE NOCASE`
    )
    .all(companyId) as { email: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.email.toLowerCase(), [...(map.get(r.email.toLowerCase()) ?? []), r.name]);
  return map;
}

/** Tirar alguém da empresa também tira dos projetos dela. */
export function removeFromAllProjects(companyId: number, email: string): void {
  db.prepare(`DELETE FROM project_members WHERE email = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)`).run(
    email.toLowerCase(),
    companyId
  );
}

export interface RepoCheck {
  remote: string;
  allowed: boolean;
  project: { id: number; name: string } | null;
}

/**
 * Pedido da extensão: "posso trabalhar nestes repositórios?". Liberado se o remote estiver num
 * projeto da empresa em que a pessoa participa (o dono participa de todos). Quando liberado,
 * registra o uso — é isso que alimenta "em uso por fulano há 3 min" no painel.
 */
export function checkRepos(
  companyId: number,
  email: string,
  isOwner: boolean,
  repos: Array<{ remote: string; branch?: string | null }>
): RepoCheck[] {
  const now = Date.now();
  return repos.slice(0, 10).map(({ remote: raw, branch }) => {
    const remote = normalizeRemote(raw);
    if (!remote) return { remote: raw, allowed: false, project: null };
    const match = db
      .prepare(
        `SELECT r.id as repoId, p.id as projectId, p.name as projectName
         FROM project_repos r JOIN projects p ON p.id = r.project_id
         WHERE p.company_id = ? AND r.remote = ?
           AND (? = 1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.email = ?))
         ORDER BY p.name COLLATE NOCASE LIMIT 1`
      )
      .get(companyId, remote, isOwner ? 1 : 0, email.toLowerCase()) as { repoId: number; projectId: number; projectName: string } | undefined;
    if (!match) return { remote, allowed: false, project: null };
    db.prepare(
      `INSERT INTO repo_activity (repo_id, email, branch, last_seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (repo_id, email) DO UPDATE SET branch = excluded.branch, last_seen_at = excluded.last_seen_at`
    ).run(match.repoId, email.toLowerCase(), typeof branch === 'string' ? branch.slice(0, 120) : null, now);
    return { remote, allowed: true, project: { id: match.projectId, name: match.projectName } };
  });
}
