// O SQL de projetos. As tabelas (projects, project_repos, project_members, repo_activity) ainda
// nascem no esquema único de shared/db/sqlite.ts; a P1 passa isso para migrations.
import type { DatabaseSync } from 'node:sqlite';
import type { ProjectRepository } from '../application/ports';
import type { Project, ProjectMember, ProjectSummary, RepoView } from '../domain/project';
import { remoteLabel } from '../domain/remote';

const PROJECT_COLUMNS = 'id, company_id as companyId, name, description, created_at as createdAt';

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: number): Project | null {
    return (this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id) as Project | undefined) ?? null;
  }

  create(companyId: number, name: string, description: string, now: number): Project {
    const result = this.db.prepare(`INSERT INTO projects (company_id, name, description, created_at) VALUES (?, ?, ?, ?)`).run(companyId, name, description, now);
    return { id: Number(result.lastInsertRowid), companyId, name, description, createdAt: now };
  }

  update(id: number, name: string, description: string): void {
    this.db.prepare(`UPDATE projects SET name = ?, description = ? WHERE id = ?`).run(name, description, id);
  }

  delete(id: number): void {
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  }

  listVisible(companyId: number, email: string, isOwner: boolean, activeSince: number): ProjectSummary[] {
    const rows = (
      isOwner
        ? this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE company_id = ? ORDER BY name COLLATE NOCASE`).all(companyId)
        : this.db
            .prepare(
              `SELECT p.id as id, p.company_id as companyId, p.name as name, p.description as description, p.created_at as createdAt
               FROM projects p JOIN project_members m ON m.project_id = p.id
               WHERE p.company_id = ? AND m.email = ? ORDER BY p.name COLLATE NOCASE`
            )
            .all(companyId, email)
    ) as unknown as Project[];

    return rows.map((p) => {
      const one = (sql: string, ...args: (string | number)[]) => this.db.prepare(sql).get(...args) as Record<string, number | null>;
      const members = this.db.prepare(`SELECT email FROM project_members WHERE project_id = ? ORDER BY added_at`).all(p.id) as { email: string }[];
      return {
        ...p,
        repoCount: Number(one(`SELECT COUNT(*) as n FROM project_repos WHERE project_id = ?`, p.id).n),
        memberCount: members.length,
        activeRepos: Number(
          one(
            `SELECT COUNT(DISTINCT r.id) as n FROM project_repos r JOIN repo_activity a ON a.repo_id = r.id
             WHERE r.project_id = ? AND a.last_seen_at > ?`,
            p.id,
            activeSince
          ).n
        ),
        lastActivityAt:
          (one(`SELECT MAX(a.last_seen_at) as at FROM project_repos r JOIN repo_activity a ON a.repo_id = r.id WHERE r.project_id = ?`, p.id).at as number | null) ??
          null,
        memberPreview: members.slice(0, 4).map((m) => m.email),
      };
    });
  }

  isMember(projectId: number, email: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM project_members WHERE project_id = ? AND email = ?`).get(projectId, email));
  }

  listMembers(projectId: number): ProjectMember[] {
    return (
      this.db
        .prepare(
          `SELECT m.email as email, m.added_at as addedAt, u.last_login_at as lastLoginAt, u.id as userId
           FROM project_members m LEFT JOIN users u ON u.email = m.email
           WHERE m.project_id = ? ORDER BY m.added_at`
        )
        .all(projectId) as { email: string; addedAt: number; lastLoginAt: number | null; userId: number | null }[]
    ).map((m) => ({ email: m.email, addedAt: m.addedAt, status: m.userId ? 'active' : 'pending', lastLoginAt: m.lastLoginAt }));
  }

  addMember(projectId: number, email: string, now: number): void {
    this.db.prepare(`INSERT INTO project_members (project_id, email, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).run(projectId, email, now);
  }

  removeMember(projectId: number, email: string): boolean {
    return Number(this.db.prepare(`DELETE FROM project_members WHERE project_id = ? AND email = ?`).run(projectId, email).changes) > 0;
  }

  projectNamesByEmail(companyId: number): Map<string, string[]> {
    const rows = this.db
      .prepare(
        `SELECT m.email as email, p.name as name FROM project_members m JOIN projects p ON p.id = m.project_id
         WHERE p.company_id = ? ORDER BY p.name COLLATE NOCASE`
      )
      .all(companyId) as { email: string; name: string }[];
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.email.toLowerCase(), [...(map.get(r.email.toLowerCase()) ?? []), r.name]);
    return map;
  }

  removeFromAllProjects(companyId: number, email: string): void {
    this.db.prepare(`DELETE FROM project_members WHERE email = ? AND project_id IN (SELECT id FROM projects WHERE company_id = ?)`).run(email, companyId);
  }

  listRepos(projectId: number, activeSince: number): RepoView[] {
    const repos = this.db
      .prepare(`SELECT id, remote, created_at as createdAt FROM project_repos WHERE project_id = ? ORDER BY created_at`)
      .all(projectId) as { id: number; remote: string; createdAt: number }[];
    return repos.map((r) => {
      const last = this.db
        .prepare(`SELECT email, branch, last_seen_at as at FROM repo_activity WHERE repo_id = ? ORDER BY last_seen_at DESC LIMIT 1`)
        .get(r.id) as { email: string; branch: string | null; at: number } | undefined;
      const recent = this.db.prepare(`SELECT COUNT(*) as n FROM repo_activity WHERE repo_id = ? AND last_seen_at > ?`).get(r.id, activeSince) as { n: number };
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

  hasRepo(projectId: number, remote: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM project_repos WHERE project_id = ? AND remote = ?`).get(projectId, remote));
  }

  addRepo(projectId: number, remote: string, now: number): void {
    this.db.prepare(`INSERT INTO project_repos (project_id, remote, created_at) VALUES (?, ?, ?)`).run(projectId, remote, now);
  }

  removeRepo(projectId: number, repoId: number): boolean {
    return Number(this.db.prepare(`DELETE FROM project_repos WHERE id = ? AND project_id = ?`).run(repoId, projectId).changes) > 0;
  }

  repoIdByRemote(projectId: number, remote: string): number | null {
    const row = this.db.prepare(`SELECT id FROM project_repos WHERE project_id = ? AND remote = ?`).get(projectId, remote) as { id: number } | undefined;
    return row?.id ?? null;
  }

  findAllowedRepo(companyId: number, remote: string, email: string, isOwner: boolean): { repoId: number; projectId: number; projectName: string } | null {
    const match = this.db
      .prepare(
        `SELECT r.id as repoId, p.id as projectId, p.name as projectName
         FROM project_repos r JOIN projects p ON p.id = r.project_id
         WHERE p.company_id = ? AND r.remote = ?
           AND (? = 1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.email = ?))
         ORDER BY p.name COLLATE NOCASE LIMIT 1`
      )
      .get(companyId, remote, isOwner ? 1 : 0, email) as { repoId: number; projectId: number; projectName: string } | undefined;
    return match ?? null;
  }

  recordActivity(repoId: number, email: string, branch: string | null, now: number): void {
    this.db
      .prepare(
        `INSERT INTO repo_activity (repo_id, email, branch, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (repo_id, email) DO UPDATE SET branch = excluded.branch, last_seen_at = excluded.last_seen_at`
      )
      .run(repoId, email, branch, now);
  }
}
