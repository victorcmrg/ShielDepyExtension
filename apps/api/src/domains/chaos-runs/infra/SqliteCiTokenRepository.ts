import type { DatabaseSync } from 'node:sqlite';
import type { CiTokenRepository } from '../application/ports';
import type { CiToken } from '../domain/ciToken';

export class SqliteCiTokenRepository implements CiTokenRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_ci_tokens (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        token_hash   TEXT NOT NULL UNIQUE,
        label        TEXT NOT NULL,
        created_by   TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at   INTEGER
      );
    `);
  }

  create(projectId: number, tokenHash: string, label: string, createdBy: string, now: number): number {
    const info = this.db
      .prepare(`INSERT INTO project_ci_tokens (project_id, token_hash, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(projectId, tokenHash, label, createdBy, now);
    return Number(info.lastInsertRowid);
  }

  listActive(projectId: number): CiToken[] {
    return this.db
      .prepare(
        `SELECT id, label, created_by as createdBy, created_at as createdAt, last_used_at as lastUsedAt
         FROM project_ci_tokens WHERE project_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`
      )
      .all(projectId) as unknown as CiToken[];
  }

  revoke(projectId: number, tokenId: number, now: number): boolean {
    const info = this.db.prepare(`UPDATE project_ci_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL`).run(now, tokenId, projectId);
    return Number(info.changes) > 0;
  }

  findActive(tokenHash: string): { id: number; projectId: number } | null {
    const row = this.db.prepare(`SELECT id, project_id as projectId FROM project_ci_tokens WHERE token_hash = ? AND revoked_at IS NULL`).get(tokenHash) as
      | { id: number; projectId: number }
      | undefined;
    return row ?? null;
  }

  markUsed(tokenId: number, now: number): void {
    this.db.prepare(`UPDATE project_ci_tokens SET last_used_at = ? WHERE id = ?`).run(now, tokenId);
  }
}
