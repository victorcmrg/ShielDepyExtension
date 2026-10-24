// Rotas da equipe da empresa (só o dono): listar, convidar, mudar o papel e remover pessoas.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson, type Route } from '../../../shared/http/http';
import type { IdentityService } from '../../identity/application/identity';
import type { Access } from '../../../shared/http/access';
import type { ProjectService } from '../../projects/application/projects';
import type { CompanyService } from '../application/companies';
import { MIN_PASSWORD, isAcceptableInitialPassword, isValidEmail, leavesNoOwner, roleFrom } from '../domain/company';

export function teamRoutes(companies: CompanyService, projects: ProjectService, identity: IdentityService, access: Access): Route[] {
  async function list(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = await access.owner(req);
    const names = await projects.projectNamesByEmail(u.companyId);
    sendJson(res, 200, {
      me: u.email,
      members: (await companies.members(u.companyId)).map((m) => ({ ...m, projects: names.get(m.email.toLowerCase()) ?? [] })),
      projects: (await projects.listFor(u.companyId, u.email, true)).map((p) => ({ id: p.id, name: p.name })),
    });
  }

  async function invite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = await access.owner(req);
    const body = await readJson<{ email?: string; initialPassword?: string; role?: string; projectIds?: unknown }>(req);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, 'e-mail inválido');
    const existing = await identity.userByEmail(email);
    if (existing && existing.companyId !== u.companyId) throw new HttpError(409, 'esse e-mail já tem conta em outra empresa');
    if (!isAcceptableInitialPassword(body.initialPassword)) {
      throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
    await companies.assign(email, u.companyId, body.initialPassword || null, roleFrom(body.role));
    const ids = Array.isArray(body.projectIds) ? body.projectIds.map(Number).filter(Number.isInteger) : [];
    for (const id of ids) {
      const p = await projects.get(id);
      if (p && p.companyId === u.companyId) await projects.addMember(id, email);
    }
    sendJson(res, 200, { ok: true });
  }

  async function setRole(req: IncomingMessage, res: ServerResponse, rawEmail: string): Promise<void> {
    const u = await access.owner(req);
    const email = decodeURIComponent(rawEmail).toLowerCase();
    const body = await readJson<{ role?: string }>(req);
    const role = roleFrom(body.role);
    if (!(await companies.isMember(u.companyId, email))) throw new HttpError(404, 'pessoa não encontrada');
    if (leavesNoOwner(role, await companies.role(email), await companies.countOwners(u.companyId))) {
      throw new HttpError(400, 'a empresa precisa de pelo menos um dono');
    }
    await companies.setRole(email, role);
    sendJson(res, 200, { ok: true });
  }

  async function remove(req: IncomingMessage, res: ServerResponse, rawEmail: string): Promise<void> {
    const u = await access.owner(req);
    const email = decodeURIComponent(rawEmail).toLowerCase();
    if (email === u.email.toLowerCase()) throw new HttpError(400, 'você não pode remover a própria conta');
    if (!(await companies.isMember(u.companyId, email))) throw new HttpError(404, 'pessoa não encontrada');
    await projects.removeFromAllProjects(u.companyId, email);
    const existing = await identity.userByEmail(email);
    if (existing) await identity.deleteUser(existing.id);
    else await companies.removeAssignment(email);
    sendJson(res, 200, { ok: true });
  }

  return [
    ['GET', /^\/api\/team$/, (req, res) => list(req, res)],
    ['POST', /^\/api\/team$/, (req, res) => invite(req, res)],
    ['PATCH', /^\/api\/team\/([^/]+)$/, (req, res, p) => setRole(req, res, p[0]!)],
    ['DELETE', /^\/api\/team\/([^/]+)$/, (req, res, p) => remove(req, res, p[0]!)],
  ];
}
