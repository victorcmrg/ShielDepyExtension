// Os tokens de CI no Postgres (tabela project_ci_tokens). O banco guarda só o hash.
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../../shared/db/postgres';
import { projectCiTokens } from '../../../shared/db/schema';
import type { CiTokenRepository } from '../application/ports';
import type { CiToken } from '../domain/ciToken';

export class DrizzleCiTokenRepository implements CiTokenRepository {
  constructor(private readonly db: Db) {}

  async create(projectId: number, tokenHash: string, label: string, createdBy: string, now: number): Promise<number> {
    const [row] = await this.db.insert(projectCiTokens).values({ projectId, tokenHash, label, createdBy, createdAt: now }).returning({ id: projectCiTokens.id });
    return row!.id;
  }

  listActive(projectId: number): Promise<CiToken[]> {
    return this.db
      .select({ id: projectCiTokens.id, label: projectCiTokens.label, createdBy: projectCiTokens.createdBy, createdAt: projectCiTokens.createdAt, lastUsedAt: projectCiTokens.lastUsedAt })
      .from(projectCiTokens)
      .where(and(eq(projectCiTokens.projectId, projectId), isNull(projectCiTokens.revokedAt)))
      .orderBy(desc(projectCiTokens.createdAt));
  }

  async revoke(projectId: number, tokenId: number, now: number): Promise<boolean> {
    const rows = await this.db
      .update(projectCiTokens)
      .set({ revokedAt: now })
      .where(and(eq(projectCiTokens.id, tokenId), eq(projectCiTokens.projectId, projectId), isNull(projectCiTokens.revokedAt)))
      .returning({ id: projectCiTokens.id });
    return rows.length > 0;
  }

  async findActive(tokenHash: string): Promise<{ id: number; projectId: number } | null> {
    const [row] = await this.db
      .select({ id: projectCiTokens.id, projectId: projectCiTokens.projectId })
      .from(projectCiTokens)
      .where(and(eq(projectCiTokens.tokenHash, tokenHash), isNull(projectCiTokens.revokedAt)));
    return row ?? null;
  }

  async markUsed(tokenId: number, now: number): Promise<void> {
    await this.db.update(projectCiTokens).set({ lastUsedAt: now }).where(eq(projectCiTokens.id, tokenId));
  }
}
