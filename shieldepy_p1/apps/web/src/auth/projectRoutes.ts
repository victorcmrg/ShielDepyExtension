// Rotas do fluxo pós-login: projetos, repositórios, pessoas e equipe da empresa, mais o
// "posso usar este repositório?" da extensão. routes.ts junta esta tabela à dele.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readBody, sendJson } from '../app';
import { addEmailAssignment, countOwners, deleteUser, findUserByEmail, getCompanyById, getCompanyPermissions, getRole, listCompanyMembers, removeEmailAssignment, setRole, type Role } from './companies';
import { isAdmin, requireDeviceToken, requireSession } from './middleware';
import {
  addProjectMember,
  addRepo,
  checkRepos,
  createProject,
  deleteProject,
  getProject,
  isProjectMember,
  listProjectMembers,
  listProjectsFor,
  listRepos,
  projectNamesByEmail,
  removeFromAllProjects,
  removeProjectMember,
  removeRepo,
  updateProject,
} from './projects';
import type { AuthUser } from './session';

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => void | Promise<void>;

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function json<T>(req: IncomingMessage): Promise<T> {
  try {
    return JSON.parse(await readBody(req)) as T;
  } catch {
    throw new HttpError(400, 'corpo da requisição inválido');
  }
}

function user(req: IncomingMessage): AuthUser {
  const u = requireSession(req);
  if (!u) throw new HttpError(401, 'não autenticado');
  return u;
}

function owner(req: IncomingMessage): AuthUser {
  const u = user(req);
  if (getRole(u.email) !== 'owner') throw new HttpError(403, 'só o dono da empresa pode fazer isso');
  return u;
}

/** Projeto da empresa do usuário — e, pra quem não é dono, só se participar dele. */
function projectFor(u: AuthUser, id: number) {
  const p = getProject(id);
  if (!p || p.companyId !== u.companyId) throw new HttpError(404, 'projeto não encontrado');
  if (getRole(u.email) !== 'owner' && !isProjectMember(id, u.email)) throw new HttpError(404, 'projeto não encontrado');
  return p;
}

function cleanText(raw: unknown, max: number, field: string, required: boolean): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (required && !value) throw new HttpError(400, `preencha ${field}`);
  if (value.length > max) throw new HttpError(400, `${field} longo demais (máx. ${max})`);
  return value;
}

// --- visão geral ---------------------------------------------------------------

function workspace(req: IncomingMessage, res: ServerResponse): void {
  const u = user(req);
  const role = getRole(u.email);
  sendJson(res, 200, {
    me: {
      email: u.email,
      role,
      isPlatformAdmin: isAdmin(u),
      companyName: getCompanyById(u.companyId)?.name ?? '',
      accessEnabled: getCompanyPermissions(u.companyId).accessEnabled !== false,
    },
    projects: listProjectsFor(u.companyId, u.email, role === 'owner'),
  });
}

// --- projetos ------------------------------------------------------------------

async function createProjectRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = owner(req);
  const body = await json<{ name?: string; description?: string }>(req);
  const project = createProject(u.companyId, cleanText(body.name, 60, 'o nome', true), cleanText(body.description, 160, 'a descrição', false));
  sendJson(res, 200, project);
}

function projectDetail(req: IncomingMessage, res: ServerResponse, id: number): void {
  const u = user(req);
  const p = projectFor(u, id);
  const isOwner = getRole(u.email) === 'owner';
  const members = listProjectMembers(id);
  const inProject = new Set(members.map((m) => m.email.toLowerCase()));
  sendJson(res, 200, {
    project: p,
    canManage: isOwner,
    repos: listRepos(id),
    members,
    // Pra o dono escolher quem entra: membros da empresa que ainda não estão no projeto
    // (donos ficam de fora — já têm acesso a todos os projetos).
    candidates: isOwner
      ? listCompanyMembers(u.companyId)
          .filter((m) => m.role !== 'owner' && !inProject.has(m.email.toLowerCase()))
          .map((m) => m.email)
      : [],
  });
}

async function updateProjectRoute(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
  const u = owner(req);
  projectFor(u, id);
  const body = await json<{ name?: string; description?: string }>(req);
  updateProject(id, cleanText(body.name, 60, 'o nome', true), cleanText(body.description, 160, 'a descrição', false));
  sendJson(res, 200, { ok: true });
}

function deleteProjectRoute(req: IncomingMessage, res: ServerResponse, id: number): void {
  const u = owner(req);
  projectFor(u, id);
  deleteProject(id);
  sendJson(res, 200, { ok: true });
}

async function addRepoRoute(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
  const u = owner(req);
  projectFor(u, id);
  const body = await json<{ url?: string }>(req);
  const result = addRepo(id, typeof body.url === 'string' ? body.url : '');
  if (!result.ok) {
    throw new HttpError(
      400,
      result.reason === 'duplicate'
        ? 'esse repositório já está neste projeto'
        : 'não parece o remote de um repositório — cole o que sai de "git remote get-url origin"'
    );
  }
  sendJson(res, 200, { ok: true, remote: result.remote });
}

function removeRepoRoute(req: IncomingMessage, res: ServerResponse, id: number, repoId: number): void {
  const u = owner(req);
  projectFor(u, id);
  if (!removeRepo(id, repoId)) throw new HttpError(404, 'repositório não encontrado');
  sendJson(res, 200, { ok: true });
}

async function addMemberRoute(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
  const u = owner(req);
  projectFor(u, id);
  const body = await json<{ email?: string }>(req);
  const email = (body.email ?? '').trim().toLowerCase();
  if (!listCompanyMembers(u.companyId).some((m) => m.email.toLowerCase() === email)) {
    throw new HttpError(400, 'essa pessoa não está na equipe da empresa — convide em Equipe primeiro');
  }
  addProjectMember(id, email);
  sendJson(res, 200, { ok: true });
}

function removeMemberRoute(req: IncomingMessage, res: ServerResponse, id: number, email: string): void {
  const u = owner(req);
  projectFor(u, id);
  if (!removeProjectMember(id, decodeURIComponent(email))) throw new HttpError(404, 'essa pessoa não está no projeto');
  sendJson(res, 200, { ok: true });
}

// --- equipe (dono) ---------------------------------------------------------------

function teamList(req: IncomingMessage, res: ServerResponse): void {
  const u = owner(req);
  const projects = projectNamesByEmail(u.companyId);
  sendJson(res, 200, {
    me: u.email,
    members: listCompanyMembers(u.companyId).map((m) => ({ ...m, projects: projects.get(m.email.toLowerCase()) ?? [] })),
    projects: listProjectsFor(u.companyId, u.email, true).map((p) => ({ id: p.id, name: p.name })),
  });
}

async function teamInvite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = owner(req);
  const body = await json<{ email?: string; initialPassword?: string; role?: string; projectIds?: unknown }>(req);
  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'e-mail inválido');
  const existing = findUserByEmail(email);
  if (existing && existing.companyId !== u.companyId) throw new HttpError(409, 'esse e-mail já tem conta em outra empresa');
  if (body.initialPassword && body.initialPassword.length < MIN_PASSWORD) {
    throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  }
  const role: Role = body.role === 'owner' ? 'owner' : 'member';
  addEmailAssignment(email, u.companyId, body.initialPassword || null, role);
  const ids = Array.isArray(body.projectIds) ? body.projectIds.map(Number).filter(Number.isInteger) : [];
  for (const id of ids) {
    const p = getProject(id);
    if (p && p.companyId === u.companyId) addProjectMember(id, email);
  }
  sendJson(res, 200, { ok: true });
}

async function teamSetRole(req: IncomingMessage, res: ServerResponse, rawEmail: string): Promise<void> {
  const u = owner(req);
  const email = decodeURIComponent(rawEmail).toLowerCase();
  const body = await json<{ role?: string }>(req);
  const role: Role = body.role === 'owner' ? 'owner' : 'member';
  if (!listCompanyMembers(u.companyId).some((m) => m.email.toLowerCase() === email)) throw new HttpError(404, 'pessoa não encontrada');
  if (role === 'member' && getRole(email) === 'owner' && countOwners(u.companyId) <= 1) {
    throw new HttpError(400, 'a empresa precisa de pelo menos um dono');
  }
  setRole(email, role);
  sendJson(res, 200, { ok: true });
}

function teamRemove(req: IncomingMessage, res: ServerResponse, rawEmail: string): void {
  const u = owner(req);
  const email = decodeURIComponent(rawEmail).toLowerCase();
  if (email === u.email.toLowerCase()) throw new HttpError(400, 'você não pode remover a própria conta');
  if (!listCompanyMembers(u.companyId).some((m) => m.email.toLowerCase() === email)) throw new HttpError(404, 'pessoa não encontrada');
  removeFromAllProjects(u.companyId, email);
  const existing = findUserByEmail(email);
  if (existing) deleteUser(existing.id);
  else removeEmailAssignment(email);
  sendJson(res, 200, { ok: true });
}

// --- extensão: "posso usar este repositório?" ----------------------------------------

async function repoCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = requireDeviceToken(req);
  if (!u) throw new HttpError(401, 'token inválido ou expirado');
  if (getCompanyPermissions(u.companyId).accessEnabled === false) {
    sendJson(res, 200, { repos: [] });
    return;
  }
  const body = await json<{ repos?: Array<{ remote?: unknown; branch?: unknown }> }>(req);
  const repos = (Array.isArray(body.repos) ? body.repos : [])
    .filter((r) => r && typeof r.remote === 'string')
    .map((r) => ({ remote: r.remote as string, branch: typeof r.branch === 'string' ? r.branch : null }));
  sendJson(res, 200, { repos: checkRepos(u.companyId, u.email, getRole(u.email) === 'owner', repos) });
}

const n = (s: string | undefined) => Number(s);

export const PROJECT_ROUTES: Array<[string, RegExp, Handler]> = [
  ['GET', /^\/api\/workspace$/, (req, res) => workspace(req, res)],
  ['POST', /^\/api\/projects$/, (req, res) => createProjectRoute(req, res)],
  ['GET', /^\/api\/projects\/(\d+)$/, (req, res, p) => projectDetail(req, res, n(p[0]))],
  ['PATCH', /^\/api\/projects\/(\d+)$/, (req, res, p) => updateProjectRoute(req, res, n(p[0]))],
  ['DELETE', /^\/api\/projects\/(\d+)$/, (req, res, p) => deleteProjectRoute(req, res, n(p[0]))],
  ['POST', /^\/api\/projects\/(\d+)\/repos$/, (req, res, p) => addRepoRoute(req, res, n(p[0]))],
  ['DELETE', /^\/api\/projects\/(\d+)\/repos\/(\d+)$/, (req, res, p) => removeRepoRoute(req, res, n(p[0]), n(p[1]))],
  ['POST', /^\/api\/projects\/(\d+)\/members$/, (req, res, p) => addMemberRoute(req, res, n(p[0]))],
  ['DELETE', /^\/api\/projects\/(\d+)\/members\/([^/]+)$/, (req, res, p) => removeMemberRoute(req, res, n(p[0]), p[1]!)],
  ['GET', /^\/api\/team$/, (req, res) => teamList(req, res)],
  ['POST', /^\/api\/team$/, (req, res) => teamInvite(req, res)],
  ['PATCH', /^\/api\/team\/([^/]+)$/, (req, res, p) => teamSetRole(req, res, p[0]!)],
  ['DELETE', /^\/api\/team\/([^/]+)$/, (req, res, p) => teamRemove(req, res, p[0]!)],
  ['POST', /^\/api\/repos\/check$/, (req, res) => repoCheck(req, res)],
];
