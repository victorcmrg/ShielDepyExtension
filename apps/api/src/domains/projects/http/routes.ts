// Rotas de projetos: a visão geral do portal, o CRUD de projetos, repositórios e membros, e o
// "posso usar este repositório?" da extensão.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, cleanText, readJson, sendJson, type Route } from '../../../shared/http/http';
import type { CompanyService } from '../../companies/application/companies';
import type { Access, RequestUser } from '../../../shared/http/access';
import type { ProjectService } from '../application/projects';

export function projectRoutes(projects: ProjectService, companies: CompanyService, access: Access): Route[] {
  /** Projeto da empresa do usuário — e, pra quem não é dono, só se participar dele (senão 404). */
  function projectFor(u: RequestUser, id: number) {
    const p = projects.visibleTo(id, { companyId: u.companyId, email: u.email, isOwner: companies.role(u.email) === 'owner' });
    if (!p) throw new HttpError(404, 'projeto não encontrado');
    return p;
  }

  function workspace(req: IncomingMessage, res: ServerResponse): void {
    const u = access.user(req);
    const role = companies.role(u.email);
    sendJson(res, 200, {
      me: {
        email: u.email,
        role,
        isPlatformAdmin: access.isAdmin(u),
        companyName: companies.get(u.companyId)?.name ?? '',
        accessEnabled: companies.accessEnabled(u.companyId),
      },
      projects: projects.listFor(u.companyId, u.email, role === 'owner'),
    });
  }

  async function create(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = access.owner(req);
    const body = await readJson<{ name?: string; description?: string }>(req);
    sendJson(res, 200, projects.create(u.companyId, cleanText(body.name, 60, 'o nome', true), cleanText(body.description, 160, 'a descrição', false)));
  }

  function detail(req: IncomingMessage, res: ServerResponse, id: number): void {
    const u = access.user(req);
    const p = projectFor(u, id);
    const isOwner = companies.role(u.email) === 'owner';
    const members = projects.listMembers(id);
    const inProject = new Set(members.map((m) => m.email.toLowerCase()));
    sendJson(res, 200, {
      project: p,
      canManage: isOwner,
      repos: projects.listRepos(id),
      members,
      // Pra o dono escolher quem entra: membros da empresa que ainda não estão no projeto
      // (donos ficam de fora — já têm acesso a todos os projetos).
      candidates: isOwner
        ? companies.members(u.companyId)
            .filter((m) => m.role !== 'owner' && !inProject.has(m.email.toLowerCase()))
            .map((m) => m.email)
        : [],
    });
  }

  async function update(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    projectFor(access.owner(req), id);
    const body = await readJson<{ name?: string; description?: string }>(req);
    projects.update(id, cleanText(body.name, 60, 'o nome', true), cleanText(body.description, 160, 'a descrição', false));
    sendJson(res, 200, { ok: true });
  }

  function remove(req: IncomingMessage, res: ServerResponse, id: number): void {
    projectFor(access.owner(req), id);
    projects.delete(id);
    sendJson(res, 200, { ok: true });
  }

  async function addRepo(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    projectFor(access.owner(req), id);
    const body = await readJson<{ url?: string }>(req);
    const result = projects.addRepo(id, typeof body.url === 'string' ? body.url : '');
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

  function removeRepo(req: IncomingMessage, res: ServerResponse, id: number, repoId: number): void {
    projectFor(access.owner(req), id);
    if (!projects.removeRepo(id, repoId)) throw new HttpError(404, 'repositório não encontrado');
    sendJson(res, 200, { ok: true });
  }

  async function addMember(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    const u = access.owner(req);
    projectFor(u, id);
    const body = await readJson<{ email?: string }>(req);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!companies.members(u.companyId).some((m) => m.email.toLowerCase() === email)) {
      throw new HttpError(400, 'essa pessoa não está na equipe da empresa — convide em Equipe primeiro');
    }
    projects.addMember(id, email);
    sendJson(res, 200, { ok: true });
  }

  function removeMember(req: IncomingMessage, res: ServerResponse, id: number, email: string): void {
    projectFor(access.owner(req), id);
    if (!projects.removeMember(id, decodeURIComponent(email))) throw new HttpError(404, 'essa pessoa não está no projeto');
    sendJson(res, 200, { ok: true });
  }

  /** Extensão: "posso usar este repositório?". */
  async function repoCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const u = access.device(req);
    if (!u) throw new HttpError(401, 'token inválido ou expirado');
    if (!companies.accessEnabled(u.companyId)) {
      sendJson(res, 200, { repos: [] });
      return;
    }
    const body = await readJson<{ repos?: Array<{ remote?: unknown; branch?: unknown }> }>(req);
    const repos = (Array.isArray(body.repos) ? body.repos : [])
      .filter((r) => r && typeof r.remote === 'string')
      .map((r) => ({ remote: r.remote as string, branch: typeof r.branch === 'string' ? r.branch : null }));
    sendJson(res, 200, { repos: projects.checkRepos({ companyId: u.companyId, email: u.email, isOwner: companies.role(u.email) === 'owner' }, repos) });
  }

  const n = (s: string | undefined) => Number(s);
  return [
    ['GET', /^\/api\/workspace$/, (req, res) => workspace(req, res)],
    ['POST', /^\/api\/projects$/, (req, res) => create(req, res)],
    ['GET', /^\/api\/projects\/(\d+)$/, (req, res, p) => detail(req, res, n(p[0]))],
    ['PATCH', /^\/api\/projects\/(\d+)$/, (req, res, p) => update(req, res, n(p[0]))],
    ['DELETE', /^\/api\/projects\/(\d+)$/, (req, res, p) => remove(req, res, n(p[0]))],
    ['POST', /^\/api\/projects\/(\d+)\/repos$/, (req, res, p) => addRepo(req, res, n(p[0]))],
    ['DELETE', /^\/api\/projects\/(\d+)\/repos\/(\d+)$/, (req, res, p) => removeRepo(req, res, n(p[0]), n(p[1]))],
    ['POST', /^\/api\/projects\/(\d+)\/members$/, (req, res, p) => addMember(req, res, n(p[0]))],
    ['DELETE', /^\/api\/projects\/(\d+)\/members\/([^/]+)$/, (req, res, p) => removeMember(req, res, n(p[0]), p[1]!)],
    ['POST', /^\/api\/repos\/check$/, (req, res) => repoCheck(req, res)],
  ];
}
