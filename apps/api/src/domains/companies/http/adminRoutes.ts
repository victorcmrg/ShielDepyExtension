// Rotas do painel da plataforma (só o admin, ADMIN_EMAIL) que mexem em empresas: visão geral,
// criar, renomear, excluir, permissões, membros e convites.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson, type Route } from '../../../shared/http/http';
import type { IdentityService } from '../../identity/application/identity';
import type { Access } from '../../../shared/http/access';
import type { CompanyService } from '../application/companies';
import { MAX_COMPANY_NAME, MIN_PASSWORD, PERMISSION_KEYS, isAcceptableInitialPassword, isValidEmail, roleFrom, type Company } from '../domain/company';

export function companyAdminRoutes(companies: CompanyService, identity: IdentityService, access: Access): Route[] {
  async function requireCompany(id: number): Promise<Company> {
    const company = await companies.get(id);
    if (!company) throw new HttpError(404, 'empresa não encontrada');
    return company;
  }

  function cleanName(raw: string | undefined): string {
    const name = raw?.trim();
    if (!name) throw new HttpError(400, "envie 'name'");
    if (name.length > MAX_COMPANY_NAME) throw new HttpError(400, `nome longo demais (máx. ${MAX_COMPANY_NAME})`);
    return name;
  }

  async function overview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await access.admin(req);
    sendJson(res, 200, await companies.overview());
  }

  async function list(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await access.admin(req);
    sendJson(res, 200, await companies.listWithPermissions());
  }

  async function create(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await access.admin(req);
    const body = await readJson<{ name?: string; aiEnabled?: boolean; ownerEmail?: string; ownerPassword?: string }>(req);
    const name = cleanName(body.name);
    // Dono opcional já na criação: é ele quem monta projetos, repositórios e equipe depois.
    const ownerEmail = body.ownerEmail?.trim().toLowerCase();
    if (ownerEmail) {
      if (!isValidEmail(ownerEmail)) throw new HttpError(400, 'e-mail do dono inválido');
      if (await identity.userByEmail(ownerEmail)) throw new HttpError(409, 'esse e-mail já tem conta em outra empresa');
      if (!isAcceptableInitialPassword(body.ownerPassword)) {
        throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
      }
    }
    const company = await companies.create(name);
    if (body.aiEnabled === true) await companies.setPermission(company.id, 'aiEnabled', true);
    if (ownerEmail) await companies.assign(ownerEmail, company.id, body.ownerPassword || null, 'owner');
    sendJson(res, 200, company);
  }

  async function rename(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    await access.admin(req);
    await requireCompany(id);
    const body = await readJson<{ name?: string }>(req);
    await companies.rename(id, cleanName(body.name));
    sendJson(res, 200, { ok: true });
  }

  async function remove(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    const a = await access.admin(req);
    await requireCompany(id);
    if (await companies.hasEmail(id, a.email)) throw new HttpError(400, 'não é possível excluir a empresa da própria conta admin');
    await companies.delete(id);
    sendJson(res, 200, { ok: true });
  }

  async function setPermission(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
    const a = await access.admin(req);
    await requireCompany(companyId);
    const body = await readJson<{ key?: string; value?: boolean }>(req);
    if (!body.key || !PERMISSION_KEYS.has(body.key) || typeof body.value !== 'boolean') {
      throw new HttpError(400, "envie 'key' (accessEnabled | aiEnabled) e 'value' (boolean)");
    }
    if (body.key === 'accessEnabled' && body.value === false && (await companies.hasEmail(companyId, a.email))) {
      throw new HttpError(400, 'não é possível suspender a empresa da própria conta admin');
    }
    await companies.setPermission(companyId, body.key, body.value);
    sendJson(res, 200, { ok: true, permissions: await companies.permissions(companyId) });
  }

  async function members(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
    await access.admin(req);
    await requireCompany(companyId);
    sendJson(res, 200, await companies.members(companyId));
  }

  async function addEmail(req: IncomingMessage, res: ServerResponse, companyId: number): Promise<void> {
    await access.admin(req);
    await requireCompany(companyId);
    const body = await readJson<{ email?: string; initialPassword?: string; role?: string }>(req);
    const email = body.email?.trim().toLowerCase();
    if (!email || !isValidEmail(email)) throw new HttpError(400, 'e-mail inválido');
    const existing = await identity.userByEmail(email);
    if (existing && existing.companyId !== companyId) {
      throw new HttpError(409, 'esse e-mail já tem conta em outra empresa — remova de lá antes');
    }
    if (!isAcceptableInitialPassword(body.initialPassword)) {
      throw new HttpError(400, `a senha inicial precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
    await companies.assign(email, companyId, body.initialPassword || null, roleFrom(body.role));
    sendJson(res, 200, { ok: true });
  }

  async function setRole(req: IncomingMessage, res: ServerResponse, email: string): Promise<void> {
    await access.admin(req);
    const body = await readJson<{ role?: string }>(req);
    if (body.role !== 'owner' && body.role !== 'member') throw new HttpError(400, "envie 'role' (owner | member)");
    await companies.setRole(decodeURIComponent(email), body.role);
    sendJson(res, 200, { ok: true });
  }

  async function removeEmail(req: IncomingMessage, res: ServerResponse, email: string): Promise<void> {
    await access.admin(req);
    const result = await companies.removeAssignment(decodeURIComponent(email));
    if (!result.ok) throw new HttpError(409, 'já existe um usuário com esse e-mail — remova o usuário em vez do convite');
    sendJson(res, 200, { ok: true });
  }

  const id = (params: string[]) => Number(params[0]);
  return [
    ['GET', /^\/api\/admin\/overview$/, (req, res) => overview(req, res)],
    ['GET', /^\/api\/admin\/companies$/, (req, res) => list(req, res)],
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
