// Todas as rotas /api/* de autenticação, multi-tenant, conta e admin. Exporta uma única
// função — handleAuthRoute — que app.ts chama antes do dispatch de /analyze e /chat;
// ela devolve `true` se tiver tratado a requisição, `false` caso contrário.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sendJson, readBody } from '../app';
import { RateLimiter } from '../sessions';
import { verifyPassword } from './passwords';
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
import {
  addEmailAssignment,
  companyHasEmail,
  createCompany,
  createUserFromAssignment,
  deleteCompany,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserByOAuthIdentity,
  getAssignment,
  getCompanyById,
  getCompanyPermissions,
  getOverview,
  getRole,
  linkOAuthIdentity,
  listCompaniesWithPermissions,
  listCompanyMembers,
  listTeammates,
  listUsers,
  removeEmailAssignment,
  renameCompany,
  setCompanyPermission,
  setRole,
  setUserPassword,
  touchLastLogin,
} from './companies';
import { PROJECT_ROUTES } from './projectRoutes';

const loginLimiter = new RateLimiter(8, 60_000);
const passwordLimiter = new RateLimiter(6, 60_000);
const PERMISSION_KEYS = new Set(['accessEnabled', 'aiEnabled']);
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
  const company = getCompanyById(user.companyId);
  return {
    email: user.email,
    companyId: user.companyId,
    companyName: company?.name ?? '',
    permissions: getCompanyPermissions(user.companyId),
    isAdmin: isAdmin(user),
    role: getRole(user.email),
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
    const assignment = getAssignment(email);
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
      const assignment = getAssignment(profile.email);
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
    accessEnabled: user ? getCompanyPermissions(user.companyId).accessEnabled !== false : null,
  });
}

async function handleDeviceConfirm(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = requireUser(req);
  // Empresa suspensa não conecta dispositivo novo — o token nem chegaria a funcionar.
  if (getCompanyPermissions(user.companyId).accessEnabled === false) {
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
  const company = getCompanyById(user.companyId);
  sendJson(res, 200, {
    email: user.email,
    companyId: user.companyId,
    companyName: company?.name ?? '',
    permissions: getCompanyPermissions(user.companyId),
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
    teammates: listTeammates(user.companyId),
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

// --- admin -------------------------------------------------------------------

function requireAdminUser(req: IncomingMessage): AuthUser {
  const user = requireUser(req);
  if (!isAdmin(user)) throw new HttpError(403, 'acesso restrito ao admin');
  return user;
}

function requireCompany(id: number) {
  const company = getCompanyById(id);
  if (!company) throw new HttpError(404, 'empresa não encontrada');
  return company;
}

async function handleAdminCreateCompany(req: IncomingMessage, res: ServerResponse): Promise<void> {
  requireAdminUser(req);
  const body = await parseJsonBody<{ name?: string; aiEnabled?: boolean; ownerEmail?: string; ownerPassword?: string }>(req);
  const name = body.name?.trim();
  if (!name) throw new HttpError(400, "envie 'name'");
  if (name.length > 80) throw new HttpError(400, 'nome longo demais (máx. 80)');
  // Dono opcional já na criação: é ele quem monta projetos, repositórios e equipe depois.
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  if (ownerEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new HttpError(400, 'e-mail do dono inválido');
    if (findUserByEmail(ownerEmail)) throw new HttpError(409, 'esse e-mail já tem conta em outra empresa');
    if (body.ownerPassword && body.ownerPassword.length < MIN_PASSWORD) {
      throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
  }
  const company = createCompany(name);
  if (body.aiEnabled === true) setCompanyPermission(company.id, 'aiEnabled', true);
  if (ownerEmail) addEmailAssignment(ownerEmail, company.id, body.ownerPassword || null, 'owner');
  sendJson(res, 200, company);
}

async function handleAdminRenameCompany(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
  requireAdminUser(req);
  requireCompany(id);
  const body = await parseJsonBody<{ name?: string }>(req);
  const name = body.name?.trim();
  if (!name) throw new HttpError(400, "envie 'name'");
  if (name.length > 80) throw new HttpError(400, 'nome longo demais (máx. 80)');
  renameCompany(id, name);
  sendJson(res, 200, { ok: true });
}

function handleAdminDeleteCompany(req: IncomingMessage, res: ServerResponse, id: number): void {
  const admin = requireAdminUser(req);
  requireCompany(id);
  if (companyHasEmail(id, admin.email)) throw new HttpError(400, 'não é possível excluir a empresa da própria conta admin');
  deleteCompany(id);
  sendJson(res, 200, { ok: true });
}

async function handleAdminSetPermission(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
  const admin = requireAdminUser(req);
  requireCompany(companyId);
  const body = await parseJsonBody<{ key?: string; value?: boolean }>(req);
  if (!body.key || !PERMISSION_KEYS.has(body.key) || typeof body.value !== 'boolean') {
    throw new HttpError(400, "envie 'key' (accessEnabled | aiEnabled) e 'value' (boolean)");
  }
  if (body.key === 'accessEnabled' && body.value === false && companyHasEmail(companyId, admin.email)) {
    throw new HttpError(400, 'não é possível suspender a empresa da própria conta admin');
  }
  setCompanyPermission(companyId, body.key, body.value);
  sendJson(res, 200, { ok: true, permissions: getCompanyPermissions(companyId) });
}

async function handleAdminAddEmail(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
  requireAdminUser(req);
  requireCompany(companyId);
  const body = await parseJsonBody<{ email?: string; initialPassword?: string; role?: string }>(req);
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'e-mail inválido');
  const existing = findUserByEmail(email);
  if (existing && existing.companyId !== companyId) {
    throw new HttpError(409, 'esse e-mail já tem conta em outra empresa — remova de lá antes');
  }
  if (body.initialPassword && body.initialPassword.length < MIN_PASSWORD) {
    throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  }
  addEmailAssignment(email, companyId, body.initialPassword || null, body.role === 'owner' ? 'owner' : 'member');
  sendJson(res, 200, { ok: true });
}

async function handleAdminSetRole(req: IncomingMessage, res: ServerResponse, email: string): Promise<void> {
  requireAdminUser(req);
  const body = await parseJsonBody<{ role?: string }>(req);
  if (body.role !== 'owner' && body.role !== 'member') throw new HttpError(400, "envie 'role' (owner | member)");
  setRole(decodeURIComponent(email), body.role);
  sendJson(res, 200, { ok: true });
}

function handleAdminRemoveEmail(req: IncomingMessage, res: ServerResponse, email: string): void {
  requireAdminUser(req);
  const result = removeEmailAssignment(decodeURIComponent(email));
  if (!result.ok) throw new HttpError(409, 'já existe um usuário com esse e-mail — remova o usuário em vez do convite');
  sendJson(res, 200, { ok: true });
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

  ['GET', /^\/api\/admin\/overview$/, adminList(getOverview)],
  ['GET', /^\/api\/admin\/companies$/, adminList(listCompaniesWithPermissions)],
  ['POST', /^\/api\/admin\/companies$/, (req, res) => handleAdminCreateCompany(req, res)],
  ['GET', /^\/api\/admin\/users$/, adminList(listUsers)],
  ['PATCH', /^\/api\/admin\/companies\/(\d+)$/, (req, res, p) => handleAdminRenameCompany(req, res, id(p))],
  ['DELETE', /^\/api\/admin\/companies\/(\d+)$/, (req, res, p) => handleAdminDeleteCompany(req, res, id(p))],
  ['PATCH', /^\/api\/admin\/companies\/(\d+)\/permissions$/, (req, res, p) => handleAdminSetPermission(req, res, id(p))],
  [
    'GET',
    /^\/api\/admin\/companies\/(\d+)\/members$/,
    (req, res, p) => {
      requireAdminUser(req);
      requireCompany(id(p));
      sendJson(res, 200, listCompanyMembers(id(p)));
    },
  ],
  ['POST', /^\/api\/admin\/companies\/(\d+)\/emails$/, (req, res, p) => handleAdminAddEmail(req, res, id(p))],
  ['DELETE', /^\/api\/admin\/emails\/([^/]+)$/, (req, res, p) => handleAdminRemoveEmail(req, res, p[0]!)],
  ['PATCH', /^\/api\/admin\/emails\/([^/]+)\/role$/, (req, res, p) => handleAdminSetRole(req, res, p[0]!)],
  ['DELETE', /^\/api\/admin\/users\/(\d+)$/, (req, res, p) => handleAdminDeleteUser(req, res, id(p))],
  ['POST', /^\/api\/admin\/users\/(\d+)\/revoke-devices$/, (req, res, p) => handleAdminRevokeDevices(req, res, id(p))],
  ...PROJECT_ROUTES,
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
