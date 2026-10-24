// As rotas /api/* de autenticação, conta e admin de usuários (vão para o domínio identity na S7e),
// mais as rotas dos domínios (DOMAIN_ROUTES). handleAuthRoute devolve `true` se tratou a requisição.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sendJson, readBody } from '../shared/http/http';
import { RateLimiter } from '../shared/http/rateLimiter';
import { verifyPassword } from '../shared/crypto/passwords';
import { requireSession, requireDeviceToken, isAdmin } from './middleware';
import { createWebSession, destroySession, type AuthUser } from './session';
import { listDevices, revokeAllDevices, revokeDeviceById, revokeDeviceToken } from './deviceTokens';
import { createOrGetDeviceAuthRequest, confirmDeviceAuthRequest, exchangeCode } from './deviceAuth';
import {
  type OAuthProvider,
  hasCredentials,
  createOAuthState,
  buildAuthorizeUrl,
  consumeOAuthState,
  exchangeCodeForProfile,
} from './oauth';
import { companies, DOMAIN_ROUTES } from '../composition';
import { createUserFromAssignment, deleteUser, findUserByEmail, findUserById, findUserByOAuthIdentity, linkOAuthIdentity, listUsers, setUserPassword, touchLastLogin } from './users';

const loginLimiter = new RateLimiter(8, 60_000);
const passwordLimiter = new RateLimiter(6, 60_000);
const MIN_PASSWORD = 8;

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'desconhecido';
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  try {
    return JSON.parse(await readBody(req)) as T;
  } catch {
    throw new HttpError(400, 'corpo da requisição inválido');
  }
}

function redirectTo(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

/** Depois do login, todo mundo começa pelos projetos (o admin da plataforma tem o painel dele no menu). */
function homeFor(_user: { email: string }): string {
  return '/projects';
}

function meBody(user: AuthUser) {
  const company = companies.get(user.companyId);
  return {
    email: user.email,
    companyId: user.companyId,
    companyName: company?.name ?? '',
    permissions: companies.permissions(user.companyId),
    isAdmin: isAdmin(user),
    role: companies.role(user.email),
  };
}

// --- /api/auth/login ---------------------------------------------------------

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody<{ email?: string; password?: string }>(req);
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) throw new HttpError(400, 'envie email e senha');

  if (!loginLimiter.allow(`${clientIp(req)}:${email}`)) {
    throw new HttpError(429, 'muitas tentativas — aguarde um instante e tente de novo');
  }

  let user = findUserByEmail(email);
  if (!user) {
    const assignment = companies.getAssignment(email);
    if (!assignment) throw new HttpError(403, 'e-mail não autorizado — peça ao admin para liberar seu acesso');
    if (!assignment.initialPasswordHash) {
      throw new HttpError(401, 'conta ainda sem senha configurada — use login social ou peça ao admin');
    }
    if (!verifyPassword(password, assignment.initialPasswordHash)) throw new HttpError(401, 'credenciais inválidas');
    user = createUserFromAssignment(email, assignment.companyId, assignment.initialPasswordHash);
  } else {
    if (!user.passwordHash) throw new HttpError(401, 'esta conta usa login social — entre com Google ou GitHub');
    if (!verifyPassword(password, user.passwordHash)) throw new HttpError(401, 'credenciais inválidas');
  }

  touchLastLogin(user.id);
  const { setCookie } = createWebSession(user.id);
  res.setHeader('set-cookie', setCookie);
  sendJson(res, 200, { email: user.email, isAdmin: isAdmin(user), home: homeFor(user) });
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('set-cookie', destroySession(req));
  sendJson(res, 200, { ok: true });
}

function requireUser(req: IncomingMessage): AuthUser {
  const user = requireSession(req);
  if (!user) throw new HttpError(401, 'não autenticado');
  return user;
}

function handleAuthMe(req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, meBody(requireUser(req)));
}

// --- OAuth ---------------------------------------------------------------

function parseProvider(raw: string): OAuthProvider | null {
  return raw === 'google' || raw === 'github' ? raw : null;
}

function handleOAuthStart(res: ServerResponse, provider: OAuthProvider, url: URL): void {
  if (!hasCredentials(provider)) throw new HttpError(500, `login com ${provider} não está configurado neste servidor`);
  const deviceState = url.searchParams.get('device_state');
  const redirectContext = deviceState ? JSON.stringify({ deviceState }) : null;
  const state = createOAuthState(provider, redirectContext);
  redirectTo(res, buildAuthorizeUrl(provider, state));
}

async function handleOAuthCallback(res: ServerResponse, provider: OAuthProvider, url: URL): Promise<void> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    redirectTo(res, '/login?error=oauth_invalid');
    return;
  }
  const consumed = consumeOAuthState(state, provider);
  if (!consumed) {
    redirectTo(res, '/login?error=oauth_expired');
    return;
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(provider, code);
  } catch {
    redirectTo(res, '/login?error=oauth_failed');
    return;
  }

  let user = findUserByOAuthIdentity(provider, profile.providerUserId);
  if (!user) {
    const existingByEmail = findUserByEmail(profile.email);
    if (existingByEmail) {
      linkOAuthIdentity(existingByEmail.id, provider, profile.providerUserId, profile.email);
      user = existingByEmail;
    } else {
      const assignment = companies.getAssignment(profile.email);
      if (!assignment) {
        redirectTo(res, '/login?error=not_assigned');
        return;
      }
      user = createUserFromAssignment(profile.email, assignment.companyId, null);
      linkOAuthIdentity(user.id, provider, profile.providerUserId, profile.email);
    }
  }

  touchLastLogin(user.id);
  const { setCookie } = createWebSession(user.id);
  res.setHeader('set-cookie', setCookie);

  let redirectContext: { deviceState?: string } = {};
  try {
    redirectContext = consumed.redirectContext ? JSON.parse(consumed.redirectContext) : {};
  } catch {
    /* contexto malformado — ignora e segue pro painel */
  }
  redirectTo(
    res,
    redirectContext.deviceState ? `/device-confirm?state=${encodeURIComponent(redirectContext.deviceState)}` : homeFor(user)
  );
}

// --- device flow (handoff navegador -> extensão VS Code) -------------------

function handleDeviceState(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const state = url.searchParams.get('state');
  if (!state) throw new HttpError(400, 'state ausente');
  const ceremony = createOrGetDeviceAuthRequest(state);
  const user = requireSession(req);
  sendJson(res, 200, {
    ceremonyStatus: ceremony.status,
    loggedIn: Boolean(user),
    email: user?.email ?? null,
    accessEnabled: user ? companies.accessEnabled(user.companyId) : null,
  });
}

async function handleDeviceConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = requireUser(req);
  // Empresa suspensa não conecta dispositivo novo — o token nem chegaria a funcionar.
  if (!companies.accessEnabled(user.companyId)) {
    throw new HttpError(403, 'o acesso da sua empresa está suspenso — fale com o administrador');
  }
  const body = await parseJsonBody<{ state?: string }>(req);
  if (!body.state) throw new HttpError(400, 'state ausente');
  const result = confirmDeviceAuthRequest(body.state, user.id);
  if (!result) throw new HttpError(400, 'solicitação expirada ou inválida — volte para o VS Code e tente novamente');
  const authority = process.env.EXTENSION_URI_AUTHORITY ?? 'shieldepy.shieldepy';
  const redirectUri = `vscode://${authority}/callback?code=${encodeURIComponent(result.redirectCode)}&state=${encodeURIComponent(body.state)}`;
  sendJson(res, 200, { redirectUri });
}

async function handleDeviceExchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseJsonBody<{ code?: string; label?: string }>(req);
  if (!body.code) throw new HttpError(400, 'code ausente');
  const result = exchangeCode(body.code, typeof body.label === 'string' ? body.label : null);
  if (!result) throw new HttpError(400, 'código inválido, expirado ou já utilizado');
  sendJson(res, 200, { token: result.token });
}

// --- API pra extensão (bearer token) ----------------------------------------

function handleApiMe(req: IncomingMessage, res: ServerResponse): void {
  const user = requireDeviceToken(req);
  if (!user) throw new HttpError(401, 'token inválido ou expirado');
  const company = companies.get(user.companyId);
  sendJson(res, 200, {
    email: user.email,
    companyId: user.companyId,
    companyName: company?.name ?? '',
    permissions: companies.permissions(user.companyId),
    // Admin da plataforma (ADMIN_EMAIL): a extensão libera qualquer pasta, com ou sem repositório.
    isAdmin: isAdmin(user),
  });
}

function handleLogoutDevice(req: IncomingMessage, res: ServerResponse): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) revokeDeviceToken(header.slice('Bearer '.length).trim());
  sendJson(res, 200, { ok: true });
}

// --- conta (qualquer membro logado) -------------------------------------------

function handleAccount(req: IncomingMessage, res: ServerResponse): void {
  const user = requireUser(req);
  const stored = findUserById(user.id);
  sendJson(res, 200, {
    ...meBody(user),
    hasPassword: Boolean(stored?.passwordHash),
    devices: listDevices(user.id),
    teammates: companies.teammates(user.companyId),
  });
}

async function handleChangePassword(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = requireUser(req);
  if (!passwordLimiter.allow(`pw:${user.id}`)) throw new HttpError(429, 'muitas tentativas — aguarde um instante');
  const body = await parseJsonBody<{ currentPassword?: string; newPassword?: string }>(req);
  const next = body.newPassword ?? '';
  if (next.length < MIN_PASSWORD) throw new HttpError(400, `a nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  const stored = findUserById(user.id);
  // Conta só com login social pode DEFINIR a primeira senha sem a atual; com senha, exige a atual.
  if (stored?.passwordHash && !verifyPassword(body.currentPassword ?? '', stored.passwordHash)) {
    throw new HttpError(401, 'senha atual incorreta');
  }
  setUserPassword(user.id, next);
  sendJson(res, 200, { ok: true });
}

function handleRevokeOwnDevice(req: IncomingMessage, res: ServerResponse, deviceId: number): void {
  const user = requireUser(req);
  if (!revokeDeviceById(user.id, deviceId)) throw new HttpError(404, 'dispositivo não encontrado');
  sendJson(res, 200, { ok: true });
}

// --- admin de usuários (o de empresas está em domains/companies/http/adminRoutes.ts) ---

function requireAdminUser(req: IncomingMessage): AuthUser {
  const user = requireUser(req);
  if (!isAdmin(user)) throw new HttpError(403, 'acesso restrito ao admin');
  return user;
}

function handleAdminDeleteUser(req: IncomingMessage, res: ServerResponse, userId: number): void {
  const admin = requireAdminUser(req);
  const target = findUserById(userId);
  if (!target) throw new HttpError(404, 'usuário não encontrado');
  if (target.id === admin.id) throw new HttpError(400, 'você não pode remover a própria conta admin');
  deleteUser(userId);
  sendJson(res, 200, { ok: true });
}

function handleAdminRevokeDevices(req: IncomingMessage, res: ServerResponse, userId: number): void {
  requireAdminUser(req);
  if (!findUserById(userId)) throw new HttpError(404, 'usuário não encontrado');
  sendJson(res, 200, { ok: true, revoked: revokeAllDevices(userId) });
}

// --- dispatch ----------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => void | Promise<void>;

function adminList(produce: () => unknown): Handler {
  return (req, res) => {
    requireAdminUser(req);
    sendJson(res, 200, produce());
  };
}

function oauth(kind: 'start' | 'callback'): Handler {
  return async (_req, res, [raw], url) => {
    const provider = parseProvider(raw!);
    if (!provider) throw new HttpError(404, 'provedor desconhecido');
    if (kind === 'start') handleOAuthStart(res, provider, url);
    else await handleOAuthCallback(res, provider, url);
  };
}

const id = (params: string[]) => Number(params[0]);

/** Tabela de rotas: método + regex do caminho → handler (grupos da regex viram `params`). */
const ROUTES: Array<[string, RegExp, Handler]> = [
  ['POST', /^\/api\/auth\/login$/, (req, res) => handleLogin(req, res)],
  ['POST', /^\/api\/auth\/logout$/, (req, res) => handleLogout(req, res)],
  ['GET', /^\/api\/auth\/me$/, (req, res) => handleAuthMe(req, res)],
  ['GET', /^\/api\/auth\/oauth\/([^/]+)\/start$/, oauth('start')],
  ['GET', /^\/api\/auth\/oauth\/([^/]+)\/callback$/, oauth('callback')],

  ['GET', /^\/api\/device\/state$/, (req, res, _p, url) => handleDeviceState(req, res, url)],
  ['POST', /^\/api\/device\/confirm$/, (req, res) => handleDeviceConfirm(req, res)],
  ['POST', /^\/api\/auth\/device\/exchange$/, (req, res) => handleDeviceExchange(req, res)],
  ['GET', /^\/api\/me$/, (req, res) => handleApiMe(req, res)],
  ['POST', /^\/api\/auth\/logout-device$/, (req, res) => handleLogoutDevice(req, res)],

  ['GET', /^\/api\/account$/, (req, res) => handleAccount(req, res)],
  ['POST', /^\/api\/account\/password$/, (req, res) => handleChangePassword(req, res)],
  ['DELETE', /^\/api\/account\/devices\/(\d+)$/, (req, res, p) => handleRevokeOwnDevice(req, res, id(p))],

  ['GET', /^\/api\/admin\/users$/, adminList(listUsers)],
  ['DELETE', /^\/api\/admin\/users\/(\d+)$/, (req, res, p) => handleAdminDeleteUser(req, res, id(p))],
  ['POST', /^\/api\/admin\/users\/(\d+)\/revoke-devices$/, (req, res, p) => handleAdminRevokeDevices(req, res, id(p))],
  ...DOMAIN_ROUTES,
];

export async function handleAuthRoute(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = pathname.match(pattern);
    if (!match) continue;
    await handler(req, res, match.slice(1), url);
    return true;
  }
  return false;
}
