// Rotas de identidade: login por senha e social, sessão, a cerimônia de "confiar" a extensão, a
// API da extensão (/api/me), a conta de cada um e a administração de usuários (admin).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson, type Route } from '../../../shared/http/http';
import { RateLimiter } from '../../../shared/http/rateLimiter';
import type { CompanyService } from '../../companies/application/companies';
import type { IdentityService } from '../application/identity';
import { parseProvider, type OAuthProvider } from '../domain/oauth';
import { normalizeEmail, type AuthUser } from '../domain/user';
import type { Access } from '../../../shared/http/access';
import { SESSION_COOKIE, buildSetCookie, parseCookies } from './cookies';

/** Depois do login, todo mundo começa pelos projetos (o admin da plataforma tem o painel dele no menu). */
const HOME = '/projects';

function redirectTo(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

const clientIp = (req: IncomingMessage) => req.socket.remoteAddress ?? 'desconhecido';

export function identityRoutes(identity: IdentityService, companies: CompanyService, access: Access): Route[] {
  const loginLimiter = new RateLimiter(8, 60_000);
  const passwordLimiter = new RateLimiter(6, 60_000);

  async function openSession(res: ServerResponse, userId: number): Promise<void> {
    const { token, maxAgeSeconds } = await identity.createSession(userId);
    res.setHeader('set-cookie', buildSetCookie(SESSION_COOKIE, token, { maxAgeSeconds }));
  }

  async function meBody(user: AuthUser) {
    return {
      email: user.email,
      companyId: user.companyId,
      companyName: (await companies.get(user.companyId))?.name ?? '',
      permissions: await companies.permissions(user.companyId),
      isAdmin: access.isAdmin(user),
      role: await companies.role(user.email),
    };
  }

  // --- login e sessão ----------------------------------------------------------------

  async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<{ email?: string; password?: string }>(req);
    const email = body.email ? normalizeEmail(body.email) : '';
    const password = body.password;
    if (!email || !password) throw new HttpError(400, 'envie email e senha');
    if (!loginLimiter.allow(`${clientIp(req)}:${email}`)) throw new HttpError(429, 'muitas tentativas — aguarde um instante e tente de novo');
    const result = await identity.loginWithPassword(email, password);
    if (!result.ok) throw new HttpError(result.status, result.error);
    await openSession(res, result.user.id);
    sendJson(res, 200, { email: result.user.email, isAdmin: access.isAdmin(result.user), home: HOME });
  }

  async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = parseCookies(req)[SESSION_COOKIE];
    if (raw) await identity.endSession(raw);
    res.setHeader('set-cookie', buildSetCookie(SESSION_COOKIE, '', { clear: true }));
    sendJson(res, 200, { ok: true });
  }

  async function me(req: IncomingMessage, res: ServerResponse): Promise<void> {
    sendJson(res, 200, await meBody(await access.user(req)));
  }

  async function oauthStart(res: ServerResponse, provider: OAuthProvider, url: URL): Promise<void> {
    if (!identity.oauthConfigured(provider)) throw new HttpError(500, `login com ${provider} não está configurado neste servidor`);
    redirectTo(res, await identity.startOAuth(provider, url.searchParams.get('device_state')));
  }

  async function oauthCallback(res: ServerResponse, provider: OAuthProvider, url: URL): Promise<void> {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return redirectTo(res, '/login?error=oauth_invalid');
    const result = await identity.finishOAuth(provider, code, state);
    if (!result.ok) return redirectTo(res, `/login?error=${result.error}`);
    await openSession(res, result.user.id);
    redirectTo(res, result.deviceState ? `/device-confirm?state=${encodeURIComponent(result.deviceState)}` : HOME);
  }

  const oauth =
    (kind: 'start' | 'callback'): Route[2] =>
    async (_req, res, [raw], url) => {
      const provider = parseProvider(raw!);
      if (!provider) throw new HttpError(404, 'provedor desconhecido');
      if (kind === 'start') await oauthStart(res, provider, url);
      else await oauthCallback(res, provider, url);
    };

  // --- device flow (handoff navegador -> extensão VS Code) ---------------------------

  async function deviceState(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const state = url.searchParams.get('state');
    if (!state) throw new HttpError(400, 'state ausente');
    const ceremonyStatus = await identity.ceremonyStatus(state);
    const user = await access.session(req);
    sendJson(res, 200, {
      ceremonyStatus,
      loggedIn: Boolean(user),
      email: user?.email ?? null,
      accessEnabled: user ? await companies.accessEnabled(user.companyId) : null,
    });
  }

  async function deviceConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await access.user(req);
    // Empresa suspensa não conecta dispositivo novo — o token nem chegaria a funcionar.
    if (!(await companies.accessEnabled(user.companyId))) throw new HttpError(403, 'o acesso da sua empresa está suspenso — fale com o administrador');
    const body = await readJson<{ state?: string }>(req);
    if (!body.state) throw new HttpError(400, 'state ausente');
    const code = await identity.confirmCeremony(body.state, user.id);
    if (!code) throw new HttpError(400, 'solicitação expirada ou inválida — volte para o VS Code e tente novamente');
    const authority = process.env.EXTENSION_URI_AUTHORITY ?? 'shieldepy.shieldepy';
    sendJson(res, 200, { redirectUri: `vscode://${authority}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(body.state)}` });
  }

  async function deviceExchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson<{ code?: string; label?: string }>(req);
    if (!body.code) throw new HttpError(400, 'code ausente');
    const token = await identity.exchangeCode(body.code, typeof body.label === 'string' ? body.label : null);
    if (!token) throw new HttpError(400, 'código inválido, expirado ou já utilizado');
    sendJson(res, 200, { token });
  }

  // --- API pra extensão (bearer token) ------------------------------------------------

  async function apiMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await access.device(req);
    if (!user) throw new HttpError(401, 'token inválido ou expirado');
    sendJson(res, 200, {
      email: user.email,
      companyId: user.companyId,
      companyName: (await companies.get(user.companyId))?.name ?? '',
      permissions: await companies.permissions(user.companyId),
      // Admin da plataforma (ADMIN_EMAIL): a extensão libera qualquer pasta, com ou sem repositório.
      isAdmin: access.isAdmin(user),
    });
  }

  async function logoutDevice(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) await identity.revokeDeviceToken(header.slice('Bearer '.length).trim());
    sendJson(res, 200, { ok: true });
  }

  // --- conta (qualquer membro logado) ---------------------------------------------------

  async function account(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await access.user(req);
    sendJson(res, 200, {
      ...(await meBody(user)),
      hasPassword: Boolean((await identity.user(user.id))?.passwordHash),
      devices: await identity.devices(user.id),
      teammates: await companies.teammates(user.companyId),
    });
  }

  async function changePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await access.user(req);
    if (!passwordLimiter.allow(`pw:${user.id}`)) throw new HttpError(429, 'muitas tentativas — aguarde um instante');
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(req);
    const result = await identity.changePassword(user.id, body.currentPassword ?? '', body.newPassword ?? '');
    if (!result.ok) throw new HttpError(result.status, result.error);
    sendJson(res, 200, { ok: true });
  }

  async function revokeOwnDevice(req: IncomingMessage, res: ServerResponse, deviceId: number): Promise<void> {
    const user = await access.user(req);
    if (!(await identity.revokeDevice(user.id, deviceId))) throw new HttpError(404, 'dispositivo não encontrado');
    sendJson(res, 200, { ok: true });
  }

  // --- admin de usuários ------------------------------------------------------------------

  async function adminUsers(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await access.admin(req);
    sendJson(res, 200, await identity.listUsers());
  }

  async function adminDeleteUser(req: IncomingMessage, res: ServerResponse, userId: number): Promise<void> {
    const admin = await access.admin(req);
    const target = await identity.user(userId);
    if (!target) throw new HttpError(404, 'usuário não encontrado');
    if (target.id === admin.id) throw new HttpError(400, 'você não pode remover a própria conta admin');
    await identity.deleteUser(userId);
    sendJson(res, 200, { ok: true });
  }

  async function adminRevokeDevices(req: IncomingMessage, res: ServerResponse, userId: number): Promise<void> {
    await access.admin(req);
    if (!(await identity.user(userId))) throw new HttpError(404, 'usuário não encontrado');
    sendJson(res, 200, { ok: true, revoked: await identity.revokeAllDevices(userId) });
  }

  const id = (params: string[]) => Number(params[0]);
  return [
    ['POST', /^\/api\/auth\/login$/, (req, res) => login(req, res)],
    ['POST', /^\/api\/auth\/logout$/, (req, res) => logout(req, res)],
    ['GET', /^\/api\/auth\/me$/, (req, res) => me(req, res)],
    ['GET', /^\/api\/auth\/oauth\/([^/]+)\/start$/, oauth('start')],
    ['GET', /^\/api\/auth\/oauth\/([^/]+)\/callback$/, oauth('callback')],

    ['GET', /^\/api\/device\/state$/, (req, res, _p, url) => deviceState(req, res, url)],
    ['POST', /^\/api\/device\/confirm$/, (req, res) => deviceConfirm(req, res)],
    ['POST', /^\/api\/auth\/device\/exchange$/, (req, res) => deviceExchange(req, res)],
    ['GET', /^\/api\/me$/, (req, res) => apiMe(req, res)],
    ['POST', /^\/api\/auth\/logout-device$/, (req, res) => logoutDevice(req, res)],

    ['GET', /^\/api\/account$/, (req, res) => account(req, res)],
    ['POST', /^\/api\/account\/password$/, (req, res) => changePassword(req, res)],
    ['DELETE', /^\/api\/account\/devices\/(\d+)$/, (req, res, p) => revokeOwnDevice(req, res, id(p))],

    ['GET', /^\/api\/admin\/users$/, (req, res) => adminUsers(req, res)],
    ['DELETE', /^\/api\/admin\/users\/(\d+)$/, (req, res, p) => adminDeleteUser(req, res, id(p))],
    ['POST', /^\/api\/admin\/users\/(\d+)\/revoke-devices$/, (req, res, p) => adminRevokeDevices(req, res, id(p))],
  ];
}
