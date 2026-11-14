// O que os casos de uso de identidade precisam de fora: o banco (Postgres com Drizzle), os
// provedores de login social e o convite da empresa.
import type { CeremonyStatus } from '../domain/deviceAuth';
import type { OAuthProfile, OAuthProvider } from '../domain/oauth';
import type { AuthUser, User, UserListing } from '../domain/user';

export interface UserRepository {
  byEmail(email: string): Promise<User | null>;
  byId(id: number): Promise<User | null>;
  byOAuthIdentity(provider: OAuthProvider, providerUserId: string): Promise<User | null>;
  create(email: string, companyId: number, passwordHash: string | null, now: number): Promise<User>;
  setPasswordHash(userId: number, hash: string): Promise<void>;
  /** Remove o usuário E o e-mail da allow-list (senão ele recriaria a conta no próximo login). */
  delete(userId: number): Promise<void>;
  touchLastLogin(userId: number, now: number): Promise<void>;
  linkOAuthIdentity(userId: number, provider: OAuthProvider, providerUserId: string, email: string, now: number): Promise<void>;
  list(): Promise<UserListing[]>;
}

export interface SessionRepository {
  create(tokenHash: string, userId: number, now: number, expiresAt: number): Promise<void>;
  find(tokenHash: string): Promise<{ user: AuthUser; expiresAt: number } | null>;
  touch(tokenHash: string, now: number): Promise<void>;
  delete(tokenHash: string): Promise<void>;
}

export interface DeviceTokenRepository {
  create(tokenHash: string, userId: number, now: number, expiresAt: number, label: string | null): Promise<void>;
  find(tokenHash: string): Promise<{ user: AuthUser; expiresAt: number; revokedAt: number | null } | null>;
  /** Marca o uso e empurra o vencimento (sliding). */
  slide(tokenHash: string, now: number, expiresAt: number): Promise<void>;
  revokeByHash(tokenHash: string, now: number): Promise<void>;
  listActive(userId: number, now: number): Promise<{ id: number; label: string | null; createdAt: number; lastUsedAt: number | null }[]>;
  revokeById(userId: number, deviceId: number, now: number): Promise<boolean>;
  revokeAll(userId: number, now: number): Promise<number>;
}

export interface DeviceAuthRepository {
  find(state: string): Promise<{ status: CeremonyStatus; expiresAt: number } | null>;
  create(state: string, now: number, expiresAt: number): Promise<void>;
  markExpired(state: string): Promise<void>;
  confirm(state: string, userId: number, codeHash: string, codeExpiresAt: number, now: number): Promise<void>;
  findByCode(codeHash: string): Promise<{ state: string; status: CeremonyStatus; userId: number | null; codeExpiresAt: number | null } | null>;
  markExchanged(state: string, now: number): Promise<void>;
}

export interface OAuthStateRepository {
  create(state: string, provider: OAuthProvider, redirectContext: string | null, now: number, expiresAt: number): Promise<void>;
  find(state: string): Promise<{ provider: string; redirectContext: string | null; expiresAt: number; consumedAt: number | null } | null>;
  consume(state: string, now: number): Promise<void>;
}

/** Os provedores de login social (Google, GitHub): I/O externo. */
export interface OAuthClient {
  hasCredentials(provider: OAuthProvider): boolean;
  authorizeUrl(provider: OAuthProvider, state: string): string;
  profile(provider: OAuthProvider, code: string): Promise<OAuthProfile>;
}

/** Do contexto de empresas: o convite do e-mail (é ele que deixa criar a conta). */
export interface Invitations {
  getAssignment(email: string): Promise<{ companyId: number; initialPasswordHash: string | null } | null>;
}
