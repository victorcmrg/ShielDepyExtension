// Rotas da equipe da empresa (só o dono): listar, convidar, mudar o papel e remover pessoas.
// Vão para o domínio companies na S7d.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sendJson, type Route } from '../shared/http/http';
import type { ProjectService } from '../domains/projects/application/projects';
import { addEmailAssignment, countOwners, deleteUser, findUserByEmail, getRole, listCompanyMembers, removeEmailAssignment, setRole, type Role } from './companies';
import { json, owner } from './guards';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function teamRoutes(projects: ProjectService): Route[] {
  function teamList(req: IncomingMessage, res: ServerResponse): void {
    const u = owner(req);
    const names = projects.projectNamesByEmail(u.companyId);
    sendJson(res, 200, {
      me: u.email,
      members: listCompanyMembers(u.companyId).map((m) => ({ ...m, projects: names.get(m.email.toLowerCase()) ?? [] })),
      projects: projects.listFor(u.companyId, u.email, true).map((p) => ({ id: p.id, name: p.name })),
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
      const p = projects.get(id);
      if (p && p.companyId === u.companyId) projects.addMember(id, email);
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
    projects.removeFromAllProjects(u.companyId, email);
    const existing = findUserByEmail(email);
    if (existing) deleteUser(existing.id);
    else removeEmailAssignment(email);
    sendJson(res, 200, { ok: true });
  }

  return [
    ['GET', /^\/api\/team$/, (req, res) => teamList(req, res)],
    ['POST', /^\/api\/team$/, (req, res) => teamInvite(req, res)],
    ['PATCH', /^\/api\/team\/([^/]+)$/, (req, res, p) => teamSetRole(req, res, p[0]!)],
    ['DELETE', /^\/api\/team\/([^/]+)$/, (req, res, p) => teamRemove(req, res, p[0]!)],
  ];
}
