// O que os casos de uso de identidade precisam de fora: o banco (SQLite hoje, Postgres na P1),
// os provedores de login social e o convite da empresa.
import type { CeremonyStatus } from '../domain/deviceAuth';
import type { OAuthProfile, OAuthProvider } from '../domain/oauth';
import type { AuthUser, User, UserListing } from '../domain/user';

export interface UserRepository {
  byEmail(email: string): User | null;
  byId(id: number): User | null;
  byOAuthIdentity(provider: OAuthProvider, providerUserId: string): User | null;
  create(email: string, companyId: number, passwordHash: string | null, now: number): User;
  setPasswordHash(userId: number, hash: string): void;
  /** Remove o usuário E o e-mail da allow-list (senão ele recriaria a conta no próximo login). */
  delete(userId: number): void;
  touchLastLogin(userId: number, now: number): void;
  linkOAuthIdentity(userId: number, provider: OAuthProvider, providerUserId: string, email: string, now: number): void;
  list(): UserListing[];
}

export interface SessionRepository {
  create(tokenHash: string, userId: number, now: number, expiresAt: number): void;
  find(tokenHash: string): { user: AuthUser; expiresAt: number } | null;
  touch(tokenHash: string, now: number): void;
  delete(tokenHash: string): void;
}

export interface DeviceTokenRepository {
  create(tokenHash: string, userId: number, now: number, expiresAt: number, label: string | null): void;
  find(tokenHash: string): { user: AuthUser; expiresAt: number; revokedAt: number | null } | null;
  /** Marca o uso e empurra o vencimento (sliding). */
  slide(tokenHash: string, now: number, expiresAt: number): void;
  revokeByHash(tokenHash: string, now: number): void;
  listActive(userId: number, now: number): { id: number; label: string | null; createdAt: number; lastUsedAt: number | null }[];
  revokeById(userId: number, deviceId: number, now: number): boolean;
  revokeAll(userId: number, now: number): number;
}

export interface DeviceAuthRepository {
  find(state: string): { status: CeremonyStatus; expiresAt: number } | null;
  create(state: string, now: number, expiresAt: number): void;
  markExpired(state: string): void;
  confirm(state: string, userId: number, codeHash: string, codeExpiresAt: number, now: number): void;
  findByCode(codeHash: string): { state: string; status: CeremonyStatus; userId: number | null; codeExpiresAt: number | null } | null;
  markExchanged(state: string, now: number): void;
}

export interface OAuthStateRepository {
  create(state: string, provider: OAuthProvider, redirectContext: string | null, now: number, expiresAt: number): void;
  find(state: string): { provider: string; redirectContext: string | null; expiresAt: number; consumedAt: number | null } | null;
  consume(state: string, now: number): void;
}

/** Os provedores de login social (Google, GitHub): I/O externo. */
export interface OAuthClient {
  hasCredentials(provider: OAuthProvider): boolean;
  authorizeUrl(provider: OAuthProvider, state: string): string;
  profile(provider: OAuthProvider, code: string): Promise<OAuthProfile>;
}

/** Do contexto de empresas: o convite do e-mail (é ele que deixa criar a conta). */
export interface Invitations {
  getAssignment(email: string): { companyId: number; initialPasswordHash: string | null } | null;
}
