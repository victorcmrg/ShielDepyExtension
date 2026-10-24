// Rotas da equipe da empresa (só o dono): listar, convidar, mudar o papel e remover pessoas.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sendJson, type Route } from '../../../shared/http/http';
import { json, owner } from '../../../auth/guards';
import { deleteUser, findUserByEmail } from '../../../auth/users';
import type { ProjectService } from '../../projects/application/projects';
import type { CompanyService } from '../application/companies';
import { MIN_PASSWORD, isAcceptableInitialPassword, isValidEmail, leavesNoOwner, roleFrom } from '../domain/company';

export function teamRoutes(companies: CompanyService, projects: ProjectService): Route[] {
  function list(req: IncomingMessage, res: ServerResponse): void {
    const u = owner(req);
    const names = projects.projectNamesByEmail(u.companyId);
    sendJson(res, 200, {
      me: u.email,
      members: companies.members(u.companyId).map((m) => ({ ...m, projects: names.get(m.email.toLowerCase()) ?? [] })),
      projects: projects.listFor(u.companyId, u.email, true).map((p) => ({ id: p.id, name: p.name })),
    });
  }

  async function invite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = owner(req);
    const body = await json<{ email?: string; initialPassword?: string; role?: string; projectIds?: unknown }>(req);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, 'e-mail inválido');
    const existing = findUserByEmail(email);
    if (existing && existing.companyId !== u.companyId) throw new HttpError(409, 'esse e-mail já tem conta em outra empresa');
    if (!isAcceptableInitialPassword(body.initialPassword)) {
      throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
    companies.assign(email, u.companyId, body.initialPassword || null, roleFrom(body.role));
    const ids = Array.isArray(body.projectIds) ? body.projectIds.map(Number).filter(Number.isInteger) : [];
    for (const id of ids) {
      const p = projects.get(id);
      if (p && p.companyId === u.companyId) projects.addMember(id, email);
    }
    sendJson(res, 200, { ok: true });
  }

  async function setRole(req: IncomingMessage, res: ServerResponse, rawEmail: string): Promise<void> {
    const u = owner(req);
    const email = decodeURIComponent(rawEmail).toLowerCase();
    const body = await json<{ role?: string }>(req);
    const role = roleFrom(body.role);
    if (!companies.isMember(u.companyId, email)) throw new HttpError(404, 'pessoa não encontrada');
    if (leavesNoOwner(role, companies.role(email), companies.countOwners(u.companyId))) {
      throw new HttpError(400, 'a empresa precisa de pelo menos um dono');
    }
    companies.setRole(email, role);
    sendJson(res, 200, { ok: true });
  }

  function remove(req: IncomingMessage, res: ServerResponse, rawEmail: string): void {
    const u = owner(req);
    const email = decodeURIComponent(rawEmail).toLowerCase();
    if (email === u.email.toLowerCase()) throw new HttpError(400, 'você não pode remover a própria conta');
    if (!companies.isMember(u.companyId, email)) throw new HttpError(404, 'pessoa não encontrada');
    projects.removeFromAllProjects(u.companyId, email);
    const existing = findUserByEmail(email);
    if (existing) deleteUser(existing.id);
    else companies.removeAssignment(email);
    sendJson(res, 200, { ok: true });
  }

  return [
    ['GET', /^\/api\/team$/, (req, res) => list(req, res)],
    ['POST', /^\/api\/team$/, (req, res) => invite(req, res)],
    ['PATCH', /^\/api\/team\/([^/]+)$/, (req, res, p) => setRole(req, res, p[0]!)],
    ['DELETE', /^\/api\/team\/([^/]+)$/, (req, res, p) => remove(req, res, p[0]!)],
  ];
}
