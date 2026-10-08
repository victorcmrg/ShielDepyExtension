// V3: o CI publica execuções do caos no portal. Banco num diretório temporário (SHIELDEPY_DATA_DIR),
// definido antes de qualquer módulo do servidor abrir o SQLite.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'shieldepy-db-'));
process.env.SHIELDEPY_DATA_DIR = dataDir;
process.env.PUBLIC_URL = 'https://portal.test';

const RESULTS = {
  version: 1,
  project: 'checkout-express',
  topologyHash: 'a'.repeat(64),
  engine: 'offline',
  ran: true,
  failOn: 'Alto',
  hits: 2,
  outcomes: [
    { hypothesisId: 'POST /checkout__race_condition__stock', routeId: 'POST /checkout', failure: 'race_condition', target: 'stock', status: 'failed', severity: 'Crítico', message: 'stateCheck: stockNeverNegative', durationMs: 200, testFile: '.shieldepy/chaos-tests/POST__checkout__race_condition__stock.spec.ts' },
    { hypothesisId: 'POST /checkout__timeout__api.stripe.com', routeId: 'POST /checkout', failure: 'timeout', target: 'api.stripe.com', status: 'failed', severity: 'Alto', message: 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta', durationMs: 6000, testFile: '.shieldepy/chaos-tests/POST__checkout__timeout__api.stripe.com.spec.ts' },
    { hypothesisId: 'POST /checkout__http_5xx_intermittent__api.stripe.com', routeId: 'POST /checkout', failure: 'http_5xx_intermittent', target: 'api.stripe.com', status: 'passed', durationMs: 300, testFile: '.shieldepy/chaos-tests/x.spec.ts' },
  ],
  untested: [{ id: 'x', routeId: 'POST /checkout', failure: 'partial_failure_after_external_call', target: 'orders', reason: 'precisa de falha injetada no banco (DB_Chaos, depois)' }],
  cost: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, unpriced: [], withoutUsage: 0 },
};

let server: Server;
let base: string;
let projectId: number;
let otherProjectId: number;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let repoId: number;
let insertRun: typeof import('../server/auth/chaosRuns').insertRun;
let repoHistory: typeof import('../server/auth/chaosRuns').repoHistory;

const cookieOf = (setCookie: string) => setCookie.split(';')[0]!;

beforeAll(async () => {
  const companies = await import('../server/auth/companies');
  const projects = await import('../server/auth/projects');
  const session = await import('../server/auth/session');
  const runs = await import('../server/auth/chaosRuns');
  insertRun = runs.insertRun;
  repoHistory = runs.repoHistory;
  const { createHandler } = await import('../server/app');

  const acme = companies.createCompany('Acme');
  const other = companies.createCompany('Outra');
  const user = (email: string, companyId: number, role: 'owner' | 'member') => {
    companies.addEmailAssignment(email, companyId, null, role);
    return companies.createUserFromAssignment(email, companyId, null);
  };
  const owner = user('dono@acme.test', acme.id, 'owner');
  const member = user('ana@acme.test', acme.id, 'member');
  const outsider = user('eve@outra.test', other.id, 'owner');
  const project = projects.createProject(acme.id, 'Pedidos', '');
  projectId = project.id;
  otherProjectId = projects.createProject(acme.id, 'Outro projeto', '').id;
  projects.addRepo(projectId, 'git@github.com:Acme/Checkout.git');
  repoId = projects.listRepos(projectId)[0]!.id;
  projects.addProjectMember(projectId, 'ana@acme.test');
  ownerCookie = cookieOf(session.createWebSession(owner.id).setCookie);
  memberCookie = cookieOf(session.createWebSession(member.id).setCookie);
  outsiderCookie = cookieOf(session.createWebSession(outsider.id).setCookie);

  const staticDir = mkdtempSync(join(tmpdir(), 'shieldepy-dist-'));
  writeFileSync(join(staticDir, 'app.html'), '<!doctype html><title>portal</title>');
  const handler = createHandler({ registry: { forPath: () => undefined } as never, provider: undefined, staticDir, examplesDir: staticDir });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // no Windows, o arquivo do banco aberto não deixa apagar a pasta
  (await import('../server/auth/db')).db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const call = async (method: string, url: string, opts: { cookie?: string; token?: string; body?: unknown } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(opts.cookie && { cookie: opts.cookie }),
      ...(opts.token && { authorization: 'Bearer ' + opts.token }),
      ...(opts.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, data: (await res.json()) as any };
};

const upload = (extra: Record<string, unknown> = {}) => ({ version: 1, remote: 'https://github.com/acme/checkout', commit: 'abc1234def', branch: 'feat/x', pr: 42, prUrl: 'https://github.com/acme/checkout/pull/42', runUrl: 'https://github.com/acme/checkout/actions/runs/9', results: RESULTS, ...extra });

describe('V3b — tokens de CI', () => {
  it('só o dono cria, lista e revoga; o valor aparece uma vez e não volta na lista', async () => {
    expect((await call('POST', `/api/projects/${projectId}/ci-tokens`, { cookie: memberCookie, body: {} })).status).toBe(403);
    const created = await call('POST', `/api/projects/${projectId}/ci-tokens`, { cookie: ownerCookie, body: { label: 'GitHub Actions' } });
    expect(created.status).toBe(200);
    expect(created.data.token).toMatch(/^sdci_/);
    const list = await call('GET', `/api/projects/${projectId}/ci-tokens`, { cookie: ownerCookie });
    expect(list.data.tokens).toHaveLength(1);
    expect(JSON.stringify(list.data)).not.toContain(created.data.token);
    expect(list.data.tokens[0]).toMatchObject({ label: 'GitHub Actions', createdBy: 'dono@acme.test', lastUsedAt: null });
    // de outra empresa: o projeto nem existe para ela
    expect((await call('GET', `/api/projects/${projectId}/ci-tokens`, { cookie: outsiderCookie })).status).toBe(404);
  });
});

describe('V3b — o CI publica uma execução', () => {
  let token: string;
  beforeAll(async () => {
    token = (await call('POST', `/api/projects/${projectId}/ci-tokens`, { cookie: ownerCookie, body: {} })).data.token;
  });

  it('com o token e um remote do projeto (escrito de outro jeito): grava e devolve o link do portal', async () => {
    const r = await call('POST', '/api/ci/chaos-runs', { token, body: upload() });
    expect(r.status).toBe(200);
    expect(r.data.url).toBe(`https://portal.test/projects/${projectId}/runs/${r.data.id}`);
    const tokens = await call('GET', `/api/projects/${projectId}/ci-tokens`, { cookie: ownerCookie });
    expect(tokens.data.tokens.find((t: { lastUsedAt: number | null }) => t.lastUsedAt)).toBeDefined();
  });

  it('sem token, token inválido, repositório fora do projeto ou payload ruim: recusa com o motivo', async () => {
    expect((await call('POST', '/api/ci/chaos-runs', { body: upload() })).status).toBe(401);
    expect((await call('POST', '/api/ci/chaos-runs', { token: 'sdci_falso', body: upload() })).status).toBe(401);
    const outside = await call('POST', '/api/ci/chaos-runs', { token, body: upload({ remote: 'https://github.com/acme/outro' }) });
    expect(outside.status).toBe(403);
    expect(outside.data.error).toContain('não está no projeto "Pedidos"');
    expect((await call('POST', '/api/ci/chaos-runs', { token, body: { version: 1, remote: 'x', commit: 'y', results: { version: 1 } } })).status).toBe(400);
    // o token de um projeto não publica no outro
    const otherToken = (await call('POST', `/api/projects/${otherProjectId}/ci-tokens`, { cookie: ownerCookie, body: {} })).data.token;
    expect((await call('POST', '/api/ci/chaos-runs', { token: otherToken, body: upload() })).status).toBe(403);
  });

  it('link que não é http(s) não é gravado (vira <a href> no portal)', async () => {
    const r = await call('POST', '/api/ci/chaos-runs', { token, body: upload({ prUrl: 'javascript:alert(1)', runUrl: 'data:text/html,x' }) });
    const run = await call('GET', `/api/projects/${projectId}/chaos/runs/${r.data.id}`, { cookie: ownerCookie });
    expect(run.data.run.prUrl).toBeNull();
    expect(run.data.run.runUrl).toBeNull();
  });

  it('token revogado deixa de publicar', async () => {
    const created = (await call('POST', `/api/projects/${projectId}/ci-tokens`, { cookie: ownerCookie, body: { label: 'velho' } })).data;
    expect((await call('DELETE', `/api/projects/${projectId}/ci-tokens/${created.id}`, { cookie: ownerCookie })).status).toBe(200);
    expect((await call('POST', '/api/ci/chaos-runs', { token: created.token, body: upload() })).status).toBe(401);
  });
});

describe('V3b — leitura no portal', () => {
  it('visão do projeto: a última execução de cada repositório (bloqueada) e o histórico', async () => {
    const r = await call('GET', `/api/projects/${projectId}/chaos`, { cookie: memberCookie });
    expect(r.status).toBe(200);
    const repo = r.data.repos[0];
    expect(repo.repo.label).toBe('acme/checkout');
    expect(repo.latest).toMatchObject({ status: 'blocked', hits: 2, failed: 2, passed: 1, invalid: 0, untested: 1, branch: 'feat/x', pr: 42, commit: 'abc1234def' });
    expect(repo.history.length).toBeGreaterThan(0);
    expect(r.data.canManage).toBe(false);
  });

  it('execução completa: resultado, repositório e histórico; outra empresa não vê', async () => {
    const latest = (await call('GET', `/api/projects/${projectId}/chaos`, { cookie: ownerCookie })).data.repos[0].latest;
    const r = await call('GET', `/api/projects/${projectId}/chaos/runs/${latest.id}`, { cookie: ownerCookie });
    expect(r.status).toBe(200);
    expect(r.data.project.name).toBe('Pedidos');
    expect(r.data.results.outcomes).toHaveLength(3);
    expect(r.data.results.untested[0].reason).toContain('DB_Chaos');
    expect((await call('GET', `/api/projects/${projectId}/chaos/runs/${latest.id}`, { cookie: outsiderCookie })).status).toBe(404);
    expect((await call('GET', `/api/projects/${projectId}/chaos/runs/999999`, { cookie: ownerCookie })).status).toBe(404);
  });

  it('retenção: só as últimas 100 execuções por repositório', () => {
    const body = { version: 1 as const, remote: 'x', commit: 'c', results: { ...RESULTS, hits: 0, outcomes: [] } as never };
    for (let i = 0; i < 105; i++) insertRun(repoId, body, Date.now() + i);
    expect(repoHistory(repoId, 500)).toHaveLength(100);
    expect(repoHistory(repoId, 1)[0]!.status).toBe('passed');
  });
});
