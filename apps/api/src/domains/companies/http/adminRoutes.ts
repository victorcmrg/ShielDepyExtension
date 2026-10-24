// Rotas do painel da plataforma (só o admin, ADMIN_EMAIL) que mexem em empresas: visão geral,
// criar, renomear, excluir, permissões, membros e convites.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson, type Route } from '../../../shared/http/http';
import type { IdentityService } from '../../identity/application/identity';
import type { Access } from '../../../shared/http/access';
import type { CompanyService } from '../application/companies';
import { MAX_COMPANY_NAME, MIN_PASSWORD, PERMISSION_KEYS, isAcceptableInitialPassword, isValidEmail, roleFrom, type Company } from '../domain/company';

export function companyAdminRoutes(companies: CompanyService, identity: IdentityService, access: Access): Route[] {
  function requireCompany(id: number): Company {
    const company = companies.get(id);
    if (!company) throw new HttpError(404, 'empresa não encontrada');
    return company;
  }

  function cleanName(raw: string | undefined): string {
    const name = raw?.trim();
    if (!name) throw new HttpError(400, "envie 'name'");
    if (name.length > MAX_COMPANY_NAME) throw new HttpError(400, `nome longo demais (máx. ${MAX_COMPANY_NAME})`);
    return name;
  }

  async function create(req: IncomingMessage, res: ServerResponse): Promise<void> {
    access.admin(req);
    const body = await readJson<{ name?: string; aiEnabled?: boolean; ownerEmail?: string; ownerPassword?: string }>(req);
    const name = cleanName(body.name);
    // Dono opcional já na criação: é ele quem monta projetos, repositórios e equipe depois.
    const ownerEmail = body.ownerEmail?.trim().toLowerCase();
    if (ownerEmail) {
      if (!isValidEmail(ownerEmail)) throw new HttpError(400, 'e-mail do dono inválido');
      if (identity.userByEmail(ownerEmail)) throw new HttpError(409, 'esse e-mail já tem conta em outra empresa');
      if (!isAcceptableInitialPassword(body.ownerPassword)) {
        throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
      }
    }
    const company = companies.create(name);
    if (body.aiEnabled === true) companies.setPermission(company.id, 'aiEnabled', true);
    if (ownerEmail) companies.assign(ownerEmail, company.id, body.ownerPassword || null, 'owner');
    sendJson(res, 200, company);
  }

  async function rename(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    access.admin(req);
    requireCompany(id);
    const body = await readJson<{ name?: string }>(req);
    companies.rename(id, cleanName(body.name));
    sendJson(res, 200, { ok: true });
  }

  function remove(req: IncomingMessage, res: ServerResponse, id: number): void {
    const a = access.admin(req);
    requireCompany(id);
    if (companies.hasEmail(id, a.email)) throw new HttpError(400, 'não é possível excluir a empresa da própria conta admin');
    companies.delete(id);
    sendJson(res, 200, { ok: true });
  }

  async function setPermission(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
    const a = access.admin(req);
    requireCompany(companyId);
    const body = await readJson<{ key?: string; value?: boolean }>(req);
    if (!body.key || !PERMISSION_KEYS.has(body.key) || typeof body.value !== 'boolean') {
      throw new HttpError(400, "envie 'key' (accessEnabled | aiEnabled) e 'value' (boolean)");
    }
    if (body.key === 'accessEnabled' && body.value === false && companies.hasEmail(companyId, a.email)) {
      throw new HttpError(400, 'não é possível suspender a empresa da própria conta admin');
    }
    companies.setPermission(companyId, body.key, body.value);
    sendJson(res, 200, { ok: true, permissions: companies.permissions(companyId) });
  }

  function members(req: IncomingMessage, res: ServerResponse, companyId: number): void {
    access.admin(req);
    requireCompany(companyId);
    sendJson(res, 200, companies.members(companyId));
  }

  async function addEmail(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
    access.admin(req);
    requireCompany(companyId);
    const body = await readJson<{ email?: string; initialPassword?: string; role?: string }>(req);
    const email = body.email?.trim().toLowerCase();
    if (!email || !isValidEmail(email)) throw new HttpError(400, 'e-mail inválido');
    const existing = identity.userByEmail(email);
    if (existing && existing.companyId !== companyId) {
      throw new HttpError(409, 'esse e-mail já tem conta em outra empresa — remova de lá antes');
    }
    if (!isAcceptableInitialPassword(body.initialPassword)) {
      throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
    companies.assign(email, companyId, body.initialPassword || null, roleFrom(body.role));
    sendJson(res, 200, { ok: true });
  }

  async function setRole(req: IncomingMessage, res: ServerResponse, email: string): Promise<void> {
    access.admin(req);
    const body = await readJson<{ role?: string }>(req);
    if (body.role !== 'owner' && body.role !== 'member') throw new HttpError(400, "envie 'role' (owner | member)");
    companies.setRole(decodeURIComponent(email), body.role);
    sendJson(res, 200, { ok: true });
  }

  function removeEmail(req: IncomingMessage, res: ServerResponse, email: string): void {
    access.admin(req);
    const result = companies.removeAssignment(decodeURIComponent(email));
    if (!result.ok) throw new HttpError(409, 'já existe um usuário com esse e-mail — remova o usuário em vez do convite');
    sendJson(res, 200, { ok: true });
  }

  const id = (params: string[]) => Number(params[0]);
  return [
    ['GET', /^\/api\/admin\/overview$/, (req, res) => (access.admin(req), sendJson(res, 200, companies.overview()))],
    ['GET', /^\/api\/admin\/companies$/, (req, res) => (access.admin(req), sendJson(res, 200, companies.listWithPermissions()))],
    ['POST', /^\/api\/admin\/companies$/, (req, res) => create(req, res)],
    ['PATCH', /^\/api\/admin\/companies\/(\d+)$/, (req, res, p) => rename(req, res, id(p))],
    ['DELETE', /^\/api\/admin\/companies\/(\d+)$/, (req, res, p) => remove(req, res, id(p))],
    ['PATCH', /^\/api\/admin\/companies\/(\d+)\/permissions$/, (req, res, p) => setPermission(req, res, id(p))],
    ['GET', /^\/api\/admin\/companies\/(\d+)\/members$/, (req, res, p) => members(req, res, id(p))],
    ['POST', /^\/api\/admin\/companies\/(\d+)\/emails$/, (req, res, p) => addEmail(req, res, id(p))],
    ['DELETE', /^\/api\/admin\/emails\/([^/]+)$/, (req, res, p) => removeEmail(req, res, p[0]!)],
    ['PATCH', /^\/api\/admin\/emails\/([^/]+)\/role$/, (req, res, p) => setRole(req, res, p[0]!)],
  ];
}
