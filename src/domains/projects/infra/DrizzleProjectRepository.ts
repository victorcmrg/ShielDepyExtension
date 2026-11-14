// Projetos no Postgres (tabelas projects, project_repos, project_members e repo_activity, de
// shared/db/schema.ts). A lista de membros lê também users (do contexto de identidade) só para mostrar.
import { and, asc, count, countDistinct, desc, eq, exists, gt, inArray, max, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../shared/db/postgres';
import { projectMembers, projectRepos, projects, repoActivity, users } from '../../../shared/db/schema';
import type { ProjectRepository } from '../application/ports';
import type { Project, ProjectMember, ProjectSummary, RepoView } from '../domain/project';
import { remoteLabel } from '../domain/remote';

const PROJECT = { id: projects.id, companyId: projects.companyId, name: projects.name, description: projects.description, createdAt: projects.createdAt };
/** Ordem por nome sem diferença de maiúsculas (o SQLite usava COLLATE NOCASE); o id desempata. */
const BY_NAME = [sql`lower(${projects.name})`, asc(projects.id)];

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: Db) {}

  async get(id: number): Promise<Project | null> {
    const [row] = await this.db.select(PROJECT).from(projects).where(eq(projects.id, id));
    return row ?? null;
  }

  async create(companyId: number, name: string, description: string, now: number): Promise<Project> {
    const [row] = await this.db.insert(projects).values({ companyId, name, description, createdAt: now }).returning(PROJECT);
    return row!;
  }

  async update(id: number, name: string, description: string): Promise<void> {
    await this.db.update(projects).set({ name, description }).where(eq(projects.id, id));
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  async listVisible(companyId: number, email: string, isOwner: boolean, activeSince: number): Promise<ProjectSummary[]> {
    const rows = isOwner
      ? await this.db.select(PROJECT).from(projects).where(eq(projects.companyId, companyId)).orderBy(...BY_NAME)
      : await this.db
          .select(PROJECT)
          .from(projects)
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(and(eq(projects.companyId, companyId), eq(projectMembers.email, email)))
          .orderBy(...BY_NAME);

    const summaries: ProjectSummary[] = [];
    for (const p of rows) {
      const members = await this.db.select({ email: projectMembers.email }).from(projectMembers).where(eq(projectMembers.projectId, p.id)).orderBy(asc(projectMembers.addedAt));
      const [repos] = await this.db.select({ n: count() }).from(projectRepos).where(eq(projectRepos.projectId, p.id));
      const activity = (where: SQL | undefined) =>
        this.db
          .select({ active: countDistinct(projectRepos.id), last: max(repoActivity.lastSeenAt) })
          .from(projectRepos)
          .innerJoin(repoActivity, eq(repoActivity.repoId, projectRepos.id))
          .where(where);
      const [active] = await activity(and(eq(projectRepos.projectId, p.id), gt(repoActivity.lastSeenAt, activeSince)));
      const [last] = await activity(eq(projectRepos.projectId, p.id));
      summaries.push({
        ...p,
        repoCount: repos?.n ?? 0,
        memberCount: members.length,
        activeRepos: active?.active ?? 0,
        lastActivityAt: last?.last ?? null,
        memberPreview: members.slice(0, 4).map((m) => m.email),
      });
    }
    return summaries;
  }

  async isMember(projectId: number, email: string): Promise<boolean> {
    const rows = await this.db
      .select({ email: projectMembers.email })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, email)));
    return rows.length > 0;
  }

  async listMembers(projectId: number): Promise<ProjectMember[]> {
    const rows = await this.db
      .select({ email: projectMembers.email, addedAt: projectMembers.addedAt, lastLoginAt: users.lastLoginAt, userId: users.id })
      .from(projectMembers)
      .leftJoin(users, eq(users.email, projectMembers.email))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.addedAt));
    return rows.map((m) => ({ email: m.email, addedAt: m.addedAt, status: m.userId ? 'active' : 'pending', lastLoginAt: m.lastLoginAt }));
  }

  async addMember(projectId: number, email: string, now: number): Promise<void> {
    await this.db.insert(projectMembers).values({ projectId, email, addedAt: now }).onConflictDoNothing();
  }

  async removeMember(projectId: number, email: string): Promise<boolean> {
    const rows = await this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, email)))
      .returning({ email: projectMembers.email });
    return rows.length > 0;
  }

  async projectNamesByEmail(companyId: number): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ email: projectMembers.email, name: projects.name })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projects.companyId, companyId))
      .orderBy(...BY_NAME);
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.email.toLowerCase(), [...(map.get(r.email.toLowerCase()) ?? []), r.name]);
    return map;
  }

  async removeFromAllProjects(companyId: number, email: string): Promise<void> {
    const ofCompany = this.db.select({ id: projects.id }).from(projects).where(eq(projects.companyId, companyId));
    await this.db.delete(projectMembers).where(and(eq(projectMembers.email, email), inArray(projectMembers.projectId, ofCompany)));
  }

  async listRepos(projectId: number, activeSince: number): Promise<RepoView[]> {
    const repos = await this.db
      .select({ id: projectRepos.id, remote: projectRepos.remote, createdAt: projectRepos.createdAt })
      .from(projectRepos)
      .where(eq(projectRepos.projectId, projectId))
      .orderBy(asc(projectRepos.createdAt), asc(projectRepos.id));
    const views: RepoView[] = [];
    for (const r of repos) {
      const [last] = await this.db
        .select({ email: repoActivity.email, branch: repoActivity.branch, at: repoActivity.lastSeenAt })
        .from(repoActivity)
        .where(eq(repoActivity.repoId, r.id))
        .orderBy(desc(repoActivity.lastSeenAt))
        .limit(1);
      const [recent] = await this.db
        .select({ n: count() })
        .from(repoActivity)
        .where(and(eq(repoActivity.repoId, r.id), gt(repoActivity.lastSeenAt, activeSince)));
      views.push({
        id: r.id,
        remote: r.remote,
        label: remoteLabel(r.remote),
        host: r.remote.split('/')[0]!,
        createdAt: r.createdAt,
        lastSeen: last ?? null,
        usersLast24h: recent?.n ?? 0,
      });
    }
    return views;
  }

  async hasRepo(projectId: number, remote: string): Promise<boolean> {
    return (await this.repoIdByRemote(projectId, remote)) !== null;
  }

  async addRepo(projectId: number, remote: string, now: number): Promise<void> {
    await this.db.insert(projectRepos).values({ projectId, remote, createdAt: now });
  }

  async removeRepo(projectId: number, repoId: number): Promise<boolean> {
    const rows = await this.db
      .delete(projectRepos)
      .where(and(eq(projectRepos.id, repoId), eq(projectRepos.projectId, projectId)))
      .returning({ id: projectRepos.id });
    return rows.length > 0;
  }

  async repoIdByRemote(projectId: number, remote: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: projectRepos.id })
      .from(projectRepos)
      .where(and(eq(projectRepos.projectId, projectId), eq(projectRepos.remote, remote)));
    return row?.id ?? null;
  }

  async findAllowedRepo(companyId: number, remote: string, email: string, isOwner: boolean): Promise<{ repoId: number; projectId: number; projectName: string } | null> {
    const isProjectMember = exists(
      this.db
        .select({ email: projectMembers.email })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projects.id), eq(projectMembers.email, email)))
    );
    const [match] = await this.db
      .select({ repoId: projectRepos.id, projectId: projects.id, projectName: projects.name })
      .from(projectRepos)
      .innerJoin(projects, eq(projects.id, projectRepos.projectId))
      .where(and(eq(projects.companyId, companyId), eq(projectRepos.remote, remote), isOwner ? undefined : isProjectMember))
      .orderBy(...BY_NAME)
      .limit(1);
    return match ?? null;
  }

  async recordActivity(repoId: number, email: string, branch: string | null, now: number): Promise<void> {
    await this.db
      .insert(repoActivity)
      .values({ repoId, email, branch, lastSeenAt: now })
      .onConflictDoUpdate({ target: [repoActivity.repoId, repoActivity.email], set: { branch, lastSeenAt: now } });
  }
}
