// Casos de uso de identidade: login por senha e social, sessão web, tokens da extensão, a
// cerimônia de "confiar" a extensão, troca de senha e a administração de usuários.
import { hashPassword, verifyPassword } from '../../../shared/crypto/passwords';
import { randomToken, sha256Hex } from '../../../shared/crypto/tokens';
import { DEFAULT_DEVICE_LABEL, DEVICE_TOKEN_PREFIX, DEVICE_TOKEN_TTL_MS, SESSION_TTL_MS, deviceLabel, isUsable, type DeviceInfo } from '../domain/credentials';
import { CEREMONY_TTL_MS, EXCHANGE_CODE_TTL_MS, canConfirm, canExchange, currentStatus, type CeremonyStatus } from '../domain/deviceAuth';
import { OAUTH_STATE_TTL_MS, canConsumeState, deviceStateFrom, redirectContextFor, type OAuthProvider } from '../domain/oauth';
import { MIN_PASSWORD, normalizeEmail, type AuthUser, type User, type UserListing } from '../domain/user';
import type { DeviceAuthRepository, DeviceTokenRepository, Invitations, OAuthClient, OAuthStateRepository, SessionRepository, UserRepository } from './ports';

export type LoginResult = { ok: true; user: User } | { ok: false; status: 401 | 403; error: string };
export type OAuthResult = { ok: true; user: User; deviceState?: string } | { ok: false; error: 'oauth_expired' | 'oauth_failed' | 'not_assigned' };
export type PasswordChange = { ok: true } | { ok: false; status: 400 | 401; error: string };

export interface IdentityRepositories {
  users: UserRepository;
  sessions: SessionRepository;
  devices: DeviceTokenRepository;
  ceremonies: DeviceAuthRepository;
  oauthStates: OAuthStateRepository;
}

export class IdentityService {
  constructor(
    private readonly repos: IdentityRepositories,
    private readonly oauth: OAuthClient,
    private readonly invitations: Invitations,
    private readonly now: () => number = Date.now
  ) {}

  // --- login -----------------------------------------------------------------------

  /** Primeiro login cria a conta a partir do convite (com a senha inicial dele). */
  async loginWithPassword(rawEmail: string, password: string): Promise<LoginResult> {
    const email = normalizeEmail(rawEmail);
    let user = await this.repos.users.byEmail(email);
    if (!user) {
      const assignment = await this.invitations.getAssignment(email);
      if (!assignment) return { ok: false, status: 403, error: 'e-mail não autorizado — peça ao admin para liberar seu acesso' };
      if (!assignment.initialPasswordHash) return { ok: false, status: 401, error: 'conta ainda sem senha configurada — use login social ou peça ao admin' };
      if (!verifyPassword(password, assignment.initialPasswordHash)) return { ok: false, status: 401, error: 'credenciais inválidas' };
      user = await this.repos.users.create(email, assignment.companyId, assignment.initialPasswordHash, this.now());
    } else {
      if (!user.passwordHash) return { ok: false, status: 401, error: 'esta conta usa login social — entre com Google ou GitHub' };
      if (!verifyPassword(password, user.passwordHash)) return { ok: false, status: 401, error: 'credenciais inválidas' };
    }
    await this.repos.users.touchLastLogin(user.id, this.now());
    return { ok: true, user };
  }

  oauthConfigured(provider: OAuthProvider): boolean {
    return this.oauth.hasCredentials(provider);
  }

  /** Começa o login social; `deviceState` volta no fim, para seguir para a cerimônia da extensão. */
  async startOAuth(provider: OAuthProvider, deviceState: string | null): Promise<string> {
    const state = randomToken(24);
    const now = this.now();
    await this.repos.oauthStates.create(state, provider, redirectContextFor(deviceState), now, now + OAUTH_STATE_TTL_MS);
    return this.oauth.authorizeUrl(provider, state);
  }

  async finishOAuth(provider: OAuthProvider, code: string, state: string): Promise<OAuthResult> {
    const saved = await this.repos.oauthStates.find(state);
    if (!saved || !canConsumeState(saved, provider, this.now())) return { ok: false, error: 'oauth_expired' };
    await this.repos.oauthStates.consume(state, this.now());

    let profile;
    try {
      profile = await this.oauth.profile(provider, code);
    } catch {
      return { ok: false, error: 'oauth_failed' };
    }

    let user = await this.repos.users.byOAuthIdentity(provider, profile.providerUserId);
    if (!user) {
      const existing = await this.repos.users.byEmail(profile.email);
      if (existing) {
        await this.repos.users.linkOAuthIdentity(existing.id, provider, profile.providerUserId, profile.email, this.now());
        user = existing;
      } else {
        const assignment = await this.invitations.getAssignment(profile.email);
        if (!assignment) return { ok: false, error: 'not_assigned' };
        user = await this.repos.users.create(profile.email, assignment.companyId, null, this.now());
        await this.repos.users.linkOAuthIdentity(user.id, provider, profile.providerUserId, profile.email, this.now());
      }
    }
    await this.repos.users.touchLastLogin(user.id, this.now());
    const deviceState = deviceStateFrom(saved.redirectContext);
    return { ok: true, user, ...(deviceState && { deviceState }) };
  }

  // --- sessão web ------------------------------------------------------------------

  /** Abre uma sessão; o valor cru vai só para o cookie. */
  async createSession(userId: number): Promise<{ token: string; maxAgeSeconds: number }> {
    const token = randomToken();
    const now = this.now();
    await this.repos.sessions.create(sha256Hex(token), userId, now, now + SESSION_TTL_MS);
    return { token, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
  }

  async sessionUser(rawToken: string): Promise<AuthUser | null> {
    const hash = sha256Hex(rawToken);
    const found = await this.repos.sessions.find(hash);
    if (!found || !isUsable(found, this.now())) return null;
    await this.repos.sessions.touch(hash, this.now());
    return found.user;
  }

  endSession(rawToken: string): Promise<void> {
    return this.repos.sessions.delete(sha256Hex(rawToken));
  }

  // --- tokens da extensão ------------------------------------------------------------

  async issueDeviceToken(userId: number, label?: string | null): Promise<string> {
    const raw = DEVICE_TOKEN_PREFIX + randomToken(32);
    const now = this.now();
    await this.repos.devices.create(sha256Hex(raw), userId, now, now + DEVICE_TOKEN_TTL_MS, deviceLabel(label));
    return raw;
  }

  async deviceUser(rawToken: string): Promise<AuthUser | null> {
    const hash = sha256Hex(rawToken);
    const found = await this.repos.devices.find(hash);
    const now = this.now();
    if (!found || !isUsable(found, now)) return null;
    await this.repos.devices.slide(hash, now, now + DEVICE_TOKEN_TTL_MS);
    return found.user;
  }

  revokeDeviceToken(rawToken: string): Promise<void> {
    return this.repos.devices.revokeByHash(sha256Hex(rawToken), this.now());
  }

  /** Dispositivos ainda válidos (não revogados, não expirados) de um usuário. */
  async devices(userId: number): Promise<DeviceInfo[]> {
    return (await this.repos.devices.listActive(userId, this.now())).map((d) => ({ ...d, label: d.label || DEFAULT_DEVICE_LABEL }));
  }

  /** Revoga um dispositivo — só se ele for mesmo deste usuário. */
  revokeDevice(userId: number, deviceId: number): Promise<boolean> {
    return this.repos.devices.revokeById(userId, deviceId, this.now());
  }

  revokeAllDevices(userId: number): Promise<number> {
    return this.repos.devices.revokeAll(userId, this.now());
  }

  // --- cerimônia "confiar a extensão" ---------------------------------------------------

  async ceremonyStatus(state: string): Promise<CeremonyStatus> {
    const now = this.now();
    const found = await this.repos.ceremonies.find(state);
    if (!found) {
      await this.repos.ceremonies.create(state, now, now + CEREMONY_TTL_MS);
      return 'pending';
    }
    const status = currentStatus(found, now);
    if (status !== found.status) await this.repos.ceremonies.markExpired(state);
    return status;
  }

  /** O navegador logado confirma: sai o código de troca, de uso único e vida curta. */
  async confirmCeremony(state: string, userId: number): Promise<string | null> {
    const now = this.now();
    const found = await this.repos.ceremonies.find(state);
    if (!found || !canConfirm(found, now)) return null;
    const code = randomToken(24);
    await this.repos.ceremonies.confirm(state, userId, sha256Hex(code), now + EXCHANGE_CODE_TTL_MS, now);
    return code;
  }

  /** A extensão troca o código pelo token de longa duração. */
  async exchangeCode(rawCode: string, label?: string | null): Promise<string | null> {
    const now = this.now();
    const found = await this.repos.ceremonies.findByCode(sha256Hex(rawCode));
    if (!found || !canExchange(found, now)) return null;
    await this.repos.ceremonies.markExchanged(found.state, now);
    return this.issueDeviceToken(found.userId!, label);
  }

  // --- conta e administração -------------------------------------------------------------

  user(id: number): Promise<User | null> {
    return this.repos.users.byId(id);
  }

  userByEmail(email: string): Promise<User | null> {
    return this.repos.users.byEmail(email.toLowerCase());
  }

  /** Conta só com login social pode DEFINIR a primeira senha sem a atual; com senha, exige a atual. */
  async changePassword(userId: number, current: string, next: string): Promise<PasswordChange> {
    if (next.length < MIN_PASSWORD) return { ok: false, status: 400, error: `a nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres` };
    const stored = await this.repos.users.byId(userId);
    if (stored?.passwordHash && !verifyPassword(current, stored.passwordHash)) return { ok: false, status: 401, error: 'senha atual incorreta' };
    await this.repos.users.setPasswordHash(userId, hashPassword(next));
    return { ok: true };
  }

  listUsers(): Promise<UserListing[]> {
    return this.repos.users.list();
  }

  deleteUser(userId: number): Promise<void> {
    return this.repos.users.delete(userId);
  }
}
