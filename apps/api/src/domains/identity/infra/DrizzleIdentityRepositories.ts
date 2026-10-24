// Identidade no Postgres: usuários e identidades sociais, sessões web, tokens da extensão, a
// cerimônia do device flow e os states do OAuth (tabelas de shared/db/schema.ts).
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../../../shared/db/postgres';
import { companies, deviceAuthRequests, deviceTokens, emailCompanyAssignments, oauthIdentities, oauthStates, sessions, users } from '../../../shared/db/schema';
import type { DeviceAuthRepository, DeviceTokenRepository, OAuthStateRepository, SessionRepository, UserRepository } from '../application/ports';
import type { CeremonyStatus } from '../domain/deviceAuth';
import type { OAuthProvider } from '../domain/oauth';
import type { AuthUser, User, UserListing } from '../domain/user';

const USER = { id: users.id, email: users.email, companyId: users.companyId, passwordHash: users.passwordHash };
const AUTH_USER = { id: users.id, email: users.email, companyId: users.companyId };

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async byEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select(USER).from(users).where(eq(users.email, email.toLowerCase()));
    return row ?? null;
  }

  async byId(id: number): Promise<User | null> {
    const [row] = await this.db.select(USER).from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async byOAuthIdentity(provider: OAuthProvider, providerUserId: string): Promise<User | null> {
    const [row] = await this.db
      .select(USER)
      .from(oauthIdentities)
      .innerJoin(users, eq(users.id, oauthIdentities.userId))
      .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.providerUserId, providerUserId)));
    return row ?? null;
  }

  async create(email: string, companyId: number, passwordHash: string | null, now: number): Promise<User> {
    const [row] = await this.db
      .insert(users)
      .values({ email: email.toLowerCase(), passwordHash, companyId, createdAt: now, lastLoginAt: now })
      .returning(USER);
    return row!;
  }

  async setPasswordHash(userId: number, hash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));
  }

  async delete(userId: number): Promise<void> {
    const user = await this.byId(userId);
    if (!user) return;
    await this.db.transaction(async (tx) => {
      await tx.delete(deviceAuthRequests).where(eq(deviceAuthRequests.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
      await tx.delete(emailCompanyAssignments).where(eq(emailCompanyAssignments.email, user.email));
    });
  }

  async touchLastLogin(userId: number, now: number): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
  }

  async linkOAuthIdentity(userId: number, provider: OAuthProvider, providerUserId: string, email: string, now: number): Promise<void> {
    await this.db
      .insert(oauthIdentities)
      .values({ userId, provider, providerUserId, email, createdAt: now })
      .onConflictDoNothing({ target: [oauthIdentities.provider, oauthIdentities.providerUserId] });
  }

  list(): Promise<UserListing[]> {
    return this.db
      .select({ id: users.id, email: users.email, companyId: users.companyId, companyName: companies.name, lastLoginAt: users.lastLoginAt })
      .from(users)
      .innerJoin(companies, eq(companies.id, users.companyId))
      .orderBy(asc(users.id));
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async create(tokenHash: string, userId: number, now: number, expiresAt: number): Promise<void> {
    await this.db.insert(sessions).values({ tokenHash, userId, createdAt: now, expiresAt, lastSeenAt: now });
  }

  async find(tokenHash: string): Promise<{ user: AuthUser; expiresAt: number } | null> {
    const [row] = await this.db
      .select({ user: AUTH_USER, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash));
    return row ?? null;
  }

  async touch(tokenHash: string, now: number): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
  }

  async delete(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
}

export class DrizzleDeviceTokenRepository implements DeviceTokenRepository {
  constructor(private readonly db: Db) {}

  async create(tokenHash: string, userId: number, now: number, expiresAt: number, label: string | null): Promise<void> {
    await this.db.insert(deviceTokens).values({ tokenHash, userId, createdAt: now, expiresAt, lastUsedAt: now, label });
  }

  async find(tokenHash: string): Promise<{ user: AuthUser; expiresAt: number; revokedAt: number | null } | null> {
    const [row] = await this.db
      .select({ user: AUTH_USER, expiresAt: deviceTokens.expiresAt, revokedAt: deviceTokens.revokedAt })
      .from(deviceTokens)
      .innerJoin(users, eq(users.id, deviceTokens.userId))
      .where(eq(deviceTokens.tokenHash, tokenHash));
    return row ?? null;
  }

  async slide(tokenHash: string, now: number, expiresAt: number): Promise<void> {
    await this.db.update(deviceTokens).set({ lastUsedAt: now, expiresAt }).where(eq(deviceTokens.tokenHash, tokenHash));
  }

  async revokeByHash(tokenHash: string, now: number): Promise<void> {
    await this.db.update(deviceTokens).set({ revokedAt: now }).where(eq(deviceTokens.tokenHash, tokenHash));
  }

  listActive(userId: number, now: number): Promise<{ id: number; label: string | null; createdAt: number; lastUsedAt: number | null }[]> {
    return this.db
      .select({ id: deviceTokens.id, label: deviceTokens.label, createdAt: deviceTokens.createdAt, lastUsedAt: deviceTokens.lastUsedAt })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt), gt(deviceTokens.expiresAt, now)))
      .orderBy(desc(deviceTokens.lastUsedAt));
  }

  async revokeById(userId: number, deviceId: number, now: number): Promise<boolean> {
    const rows = await this.db
      .update(deviceTokens)
      .set({ revokedAt: now })
      .where(and(eq(deviceTokens.id, deviceId), eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
      .returning({ id: deviceTokens.id });
    return rows.length > 0;
  }

  async revokeAll(userId: number, now: number): Promise<number> {
    const rows = await this.db
      .update(deviceTokens)
      .set({ revokedAt: now })
      .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
      .returning({ id: deviceTokens.id });
    return rows.length;
  }
}

export class DrizzleDeviceAuthRepository implements DeviceAuthRepository {
  constructor(private readonly db: Db) {}

  async find(state: string): Promise<{ status: CeremonyStatus; expiresAt: number } | null> {
    const [row] = await this.db.select({ status: deviceAuthRequests.status, expiresAt: deviceAuthRequests.expiresAt }).from(deviceAuthRequests).where(eq(deviceAuthRequests.state, state));
    return row ? { status: row.status as CeremonyStatus, expiresAt: row.expiresAt } : null;
  }

  async create(state: string, now: number, expiresAt: number): Promise<void> {
    await this.db.insert(deviceAuthRequests).values({ state, status: 'pending', createdAt: now, expiresAt });
  }

  async markExpired(state: string): Promise<void> {
    await this.db.update(deviceAuthRequests).set({ status: 'expired' }).where(eq(deviceAuthRequests.state, state));
  }

  async confirm(state: string, userId: number, codeHash: string, codeExpiresAt: number, now: number): Promise<void> {
    await this.db
      .update(deviceAuthRequests)
      .set({ status: 'confirmed', userId, exchangeCodeHash: codeHash, exchangeCodeExpiresAt: codeExpiresAt, confirmedAt: now })
      .where(eq(deviceAuthRequests.state, state));
  }

  async findByCode(codeHash: string): Promise<{ state: string; status: CeremonyStatus; userId: number | null; codeExpiresAt: number | null } | null> {
    const [row] = await this.db
      .select({ state: deviceAuthRequests.state, status: deviceAuthRequests.status, userId: deviceAuthRequests.userId, codeExpiresAt: deviceAuthRequests.exchangeCodeExpiresAt })
      .from(deviceAuthRequests)
      .where(eq(deviceAuthRequests.exchangeCodeHash, codeHash));
    return row ? { ...row, status: row.status as CeremonyStatus } : null;
  }

  async markExchanged(state: string, now: number): Promise<void> {
    await this.db.update(deviceAuthRequests).set({ status: 'exchanged', exchangedAt: now }).where(eq(deviceAuthRequests.state, state));
  }
}

export class DrizzleOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly db: Db) {}

  async create(state: string, provider: OAuthProvider, redirectContext: string | null, now: number, expiresAt: number): Promise<void> {
    await this.db.insert(oauthStates).values({ state, provider, redirectContext, createdAt: now, expiresAt });
  }

  async find(state: string): Promise<{ provider: string; redirectContext: string | null; expiresAt: number; consumedAt: number | null } | null> {
    const [row] = await this.db
      .select({ provider: oauthStates.provider, redirectContext: oauthStates.redirectContext, expiresAt: oauthStates.expiresAt, consumedAt: oauthStates.consumedAt })
      .from(oauthStates)
      .where(eq(oauthStates.state, state));
    return row ?? null;
  }

  async consume(state: string, now: number): Promise<void> {
    await this.db.update(oauthStates).set({ consumedAt: now }).where(eq(oauthStates.state, state));
  }
}
