// Rotas do caos no CI (V3): tokens de CI (dono do projeto), a publicação pelo CI e a leitura no portal.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sendJson, type Route } from '../../../shared/http/http';
import { cleanText, json, owner, projectFor, user } from '../../../auth/guards';
import type { CompanyService } from '../../companies/application/companies';
import type { ProjectService } from '../../projects/application/projects';
import type { ChaosRunService } from '../application/chaosRuns';
import { UploadError } from '../domain/upload';

/** Endereço público do portal, para o link que volta ao CI. */
function publicBase(req: IncomingMessage): string {
  const configured = process.env.PUBLIC_URL ?? process.env.OAUTH_REDIRECT_BASE;
  if (configured) return configured.replace(/\/+$/, '');
  return 'http://' + (req.headers.host ?? 'localhost:3001');
}

export function chaosRunRoutes(runs: ChaosRunService, projects: ProjectService, companies: CompanyService): Route[] {
  function listCiTokens(req: IncomingMessage, res: ServerResponse, id: number): void {
    projectFor(owner(req), id);
    sendJson(res, 200, { tokens: runs.listCiTokens(id) });
  }

  async function createCiToken(req: IncomingMessage, res: ServerResponse, id: number): Promise<void> {
    const u = owner(req);
    projectFor(u, id);
    const body = await json<{ label?: string }>(req);
    const label = cleanText(body.label, 60, 'o nome', false) || 'GitHub Actions';
    sendJson(res, 200, runs.createCiToken(id, label, u.email));
  }

  function revokeCiToken(req: IncomingMessage, res: ServerResponse, id: number, tokenId: number): void {
    projectFor(owner(req), id);
    if (!runs.revokeCiToken(id, tokenId)) throw new HttpError(404, 'token não encontrado');
    sendJson(res, 200, { ok: true });
  }

  /** O CI publica uma execução (Authorization: Bearer sdci_…). Só em repositórios do projeto do token. */
  async function publish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = req.headers.authorization ?? '';
    const projectId = auth.startsWith('Bearer ') ? runs.projectForCiToken(auth.slice(7).trim()) : null;
    if (!projectId) throw new HttpError(401, 'token de CI inválido ou revogado');
    const project = projects.get(projectId);
    if (!project) throw new HttpError(401, 'token de CI inválido ou revogado');
    if (!companies.accessEnabled(project.companyId)) throw new HttpError(403, 'o acesso desta empresa está suspenso');
    let result;
    try {
      result = runs.publish(projectId, await json<unknown>(req));
    } catch (err) {
      if (err instanceof UploadError) throw new HttpError(400, err.message);
      throw err;
    }
    if (!result.ok) throw new HttpError(403, `este repositório não está no projeto "${project.name}" — conecte o remote na página do projeto`);
    sendJson(res, 200, { id: result.runId, url: `${publicBase(req)}/projects/${projectId}/runs/${result.runId}` });
  }

  /** Visão do caos no projeto: a última execução e o histórico curto de cada repositório. */
  function projectChaos(req: IncomingMessage, res: ServerResponse, id: number): void {
    const u = user(req);
    projectFor(u, id);
    const repos = projects.listRepos(id).map((repo) => {
      const history = runs.history(repo.id);
      return { repo: { id: repo.id, label: repo.label, remote: repo.remote }, latest: history[0] ?? null, history };
    });
    sendJson(res, 200, { repos, canManage: companies.role(u.email) === 'owner' });
  }

  function runDetail(req: IncomingMessage, res: ServerResponse, id: number, runId: number): void {
    const project = projectFor(user(req), id);
    const run = runs.getRun(id, runId);
    if (!run) throw new HttpError(404, 'execução não encontrada');
    const repo = projects.listRepos(id).find((r) => r.id === run.summary.repoId);
    sendJson(res, 200, {
      project: { id: project.id, name: project.name },
      repo: repo ? { id: repo.id, label: repo.label, remote: repo.remote } : null,
      run: run.summary,
      results: run.results,
      history: runs.history(run.summary.repoId),
    });
  }

  const n = (s: string | undefined) => Number(s);
  return [
    ['GET', /^\/api\/projects\/(\d+)\/ci-tokens$/, (req, res, p) => listCiTokens(req, res, n(p[0]))],
    ['POST', /^\/api\/projects\/(\d+)\/ci-tokens$/, (req, res, p) => createCiToken(req, res, n(p[0]))],
    ['DELETE', /^\/api\/projects\/(\d+)\/ci-tokens\/(\d+)$/, (req, res, p) => revokeCiToken(req, res, n(p[0]), n(p[1]))],
    ['POST', /^\/api\/ci\/chaos-runs$/, (req, res) => publish(req, res)],
    ['GET', /^\/api\/projects\/(\d+)\/chaos$/, (req, res, p) => projectChaos(req, res, n(p[0]))],
    ['GET', /^\/api\/projects\/(\d+)\/chaos\/runs\/(\d+)$/, (req, res, p) => runDetail(req, res, n(p[0]), n(p[1]))],
  ];
}
