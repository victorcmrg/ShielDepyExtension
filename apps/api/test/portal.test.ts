// As rotas do portal contra o banco de verdade (PGlite numa pasta temporária, P1b): login e conta,
// equipe, projetos, o painel do admin e o device flow da extensão. Cobre o SQL de identity,
// companies e projects, que os testes de domínio (repositórios em memória) não tocam.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'shieldepy-db-'));
process.env.SHIELDEPY_DATA_DIR = dataDir;
process.env.ADMIN_EMAIL = 'admin@shieldepy.test';

const PASSWORD = 'Senha-Inicial-1';
let server: Server;
let base: string;
let acmeId: number;
let admin: string;
let owner: string;

const call = async (method: string, url: string, opts: { cookie?: string; token?: string; body?: unknown } = {}) => {
  const res = await fetch(base + url, {
    method,
    redirect: 'manual',
    headers: {
      ...(opts.cookie && { cookie: opts.cookie }),
      ...(opts.token && { authorization: 'Bearer ' + opts.token }),
      ...(opts.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as any, setCookie: res.headers.get('set-cookie') };
};

/** Entra com e-mail e senha e devolve o cookie da sessão. */
async function login(email: string, password = PASSWORD): Promise<string> {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  expect(r.status, `login de ${email}: ${JSON.stringify(r.data)}`).toBe(200);
  return r.setCookie!.split(';')[0]!;
}

beforeAll(async () => {
  const { companies } = await import('../src/composition');
  const { createHandler } = await import('../src/app');
  const platform = await companies.create('ShielDepy (admin)');
  await companies.assign('admin@shieldepy.test', platform.id, PASSWORD, 'owner');
  acmeId = (await companies.create('Acme')).id;
  await companies.assign('dono@acme.test', acmeId, PASSWORD, 'owner');

  const staticDir = mkdtempSync(join(tmpdir(), 'shieldepy-dist-'));
  writeFileSync(join(staticDir, 'app.html'), '<!doctype html><title>portal</title>');
  const handler = createHandler({ staticDir });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await login('admin@shieldepy.test');
  owner = await login('Dono@Acme.test');
}, 60_000); // abrir o PGlite e aplicar as migrations passa dos 10 s padrão com a suíte inteira rodando

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await (await import('../src/composition')).database.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('login e conta', () => {
  it('o primeiro login cria a conta pelo convite; sem convite 403; senha errada 401', async () => {
    expect((await call('POST', '/api/auth/login', { body: { email: 'ninguem@acme.test', password: PASSWORD } })).status).toBe(403);
    expect((await call('POST', '/api/auth/login', { body: { email: 'dono@acme.test', password: 'errada-123' } })).status).toBe(401);
    const me = await call('GET', '/api/auth/me', { cookie: owner });
    expect(me.data).toMatchObject({ email: 'dono@acme.test', companyName: 'Acme', role: 'owner', isAdmin: false, permissions: { accessEnabled: true, aiEnabled: false } });
    expect((await call('GET', '/api/auth/me')).status).toBe(401);
  });

  it('troca de senha e logout encerram o que devem', async () => {
    const { companies } = await import('../src/composition');
    await companies.assign('troca@acme.test', acmeId, PASSWORD);
    const cookie = await login('troca@acme.test');
    expect((await call('POST', '/api/account/password', { cookie, body: { currentPassword: 'errada', newPassword: 'Nova-Senha-22' } })).status).toBe(401);
    expect((await call('POST', '/api/account/password', { cookie, body: { currentPassword: PASSWORD, newPassword: 'Nova-Senha-22' } })).status).toBe(200);
    await login('troca@acme.test', 'Nova-Senha-22');
    expect((await call('POST', '/api/auth/logout', { cookie })).status).toBe(200);
    expect((await call('GET', '/api/account', { cookie })).status).toBe(401);
  });
});

describe('equipe e projetos (dono)', () => {
  it('convidar, listar por nome sem diferença de maiúsculas, membro só vê o projeto de que participa', async () => {
    const zeta = (await call('POST', '/api/projects', { cookie: owner, body: { name: 'zeta', description: '' } })).data;
    const alfa = (await call('POST', '/api/projects', { cookie: owner, body: { name: 'Alfa', description: 'primeiro' } })).data;
    expect((await call('POST', '/api/team', { cookie: owner, body: { email: 'Ana@Acme.test', initialPassword: PASSWORD, projectIds: [alfa.id] } })).status).toBe(200);
    expect((await call('POST', '/api/team', { cookie: owner, body: { email: 'carla@acme.test' } })).status).toBe(200);

    const team = (await call('GET', '/api/team', { cookie: owner })).data;
    expect(team.projects.map((p: { name: string }) => p.name)).toEqual(['Alfa', 'zeta']);
    const ana = team.members.find((m: { email: string }) => m.email === 'ana@acme.test');
    expect(ana).toMatchObject({ status: 'pending', role: 'member', projects: ['Alfa'] });

    const anaCookie = await login('ana@acme.test');
    const ws = (await call('GET', '/api/workspace', { cookie: anaCookie })).data;
    expect(ws.me).toMatchObject({ role: 'member', companyName: 'Acme', accessEnabled: true });
    expect(ws.projects.map((p: { name: string }) => p.name)).toEqual(['Alfa']);
    expect((await call('GET', `/api/projects/${zeta.id}`, { cookie: anaCookie })).status).toBe(404);
    expect((await call('POST', '/api/projects', { cookie: anaCookie, body: { name: 'x' } })).status).toBe(403);

    const detail = (await call('GET', `/api/projects/${alfa.id}`, { cookie: owner })).data;
    expect(detail.members).toEqual([expect.objectContaining({ email: 'ana@acme.test', status: 'active' })]);
    // quem já tem conta primeiro, depois os convites pendentes
    expect(detail.candidates).toEqual(['troca@acme.test', 'carla@acme.test']);
  });

  it('repositórios: duplicado recusado, uso registrado pela extensão aparece na lista e no card', async () => {
    const p = (await call('POST', '/api/projects', { cookie: owner, body: { name: 'Pedidos' } })).data;
    expect((await call('POST', `/api/projects/${p.id}/repos`, { cookie: owner, body: { url: 'git@github.com:Acme/Pedidos.git' } })).data.remote).toBe('github.com/acme/pedidos');
    expect((await call('POST', `/api/projects/${p.id}/repos`, { cookie: owner, body: { url: 'https://github.com/acme/pedidos' } })).status).toBe(400);
    expect((await call('PATCH', `/api/projects/${p.id}`, { cookie: owner, body: { name: 'Pedidos API', description: 'novo' } })).status).toBe(200);

    const { identity } = await import('../src/composition');
    const user = (await identity.userByEmail('dono@acme.test'))!;
    const token = await identity.issueDeviceToken(user.id, 'VS Code');
    const check = await call('POST', '/api/repos/check', { token, body: { repos: [{ remote: 'https://github.com/acme/pedidos.git', branch: 'main' }, { remote: 'github.com/acme/outro' }] } });
    expect(check.data.repos).toEqual([
      { remote: 'github.com/acme/pedidos', allowed: true, project: { id: p.id, name: 'Pedidos API' } },
      { remote: 'github.com/acme/outro', allowed: false, project: null },
    ]);
    // a segunda vez atualiza o uso (ON CONFLICT), não duplica
    await call('POST', '/api/repos/check', { token, body: { repos: [{ remote: 'github.com/acme/pedidos', branch: 'feat/x' }] } });

    const repo = (await call('GET', `/api/projects/${p.id}`, { cookie: owner })).data.repos[0];
    expect(repo).toMatchObject({ label: 'acme/pedidos', host: 'github.com', usersLast24h: 1, lastSeen: { email: 'dono@acme.test', branch: 'feat/x' } });
    const card = (await call('GET', '/api/workspace', { cookie: owner })).data.projects.find((x: { id: number }) => x.id === p.id);
    expect(card).toMatchObject({ repoCount: 1, activeRepos: 1, memberCount: 0 });
    expect(card.lastActivityAt).toEqual(expect.any(Number));

    expect((await call('DELETE', `/api/projects/${p.id}/repos/${repo.id}`, { cookie: owner })).status).toBe(200);
    expect((await call('DELETE', `/api/projects/${p.id}`, { cookie: owner })).status).toBe(200);
    expect((await call('GET', `/api/projects/${p.id}`, { cookie: owner })).status).toBe(404);
  });

  it('a empresa nunca fica sem dono; remover tira dos projetos e apaga a conta', async () => {
    expect((await call('PATCH', '/api/team/dono%40acme.test', { cookie: owner, body: { role: 'member' } })).status).toBe(400);
    expect((await call('DELETE', '/api/team/dono%40acme.test', { cookie: owner })).status).toBe(400);
    expect((await call('DELETE', '/api/team/ana%40acme.test', { cookie: owner })).status).toBe(200);
    expect((await call('DELETE', '/api/team/carla%40acme.test', { cookie: owner })).status).toBe(200);
    const team = (await call('GET', '/api/team', { cookie: owner })).data;
    expect(team.members.map((m: { email: string }) => m.email)).toEqual(['dono@acme.test', 'troca@acme.test']);
    expect((await call('POST', '/api/auth/login', { body: { email: 'ana@acme.test', password: PASSWORD } })).status).toBe(403);
  });
});

describe('device flow da extensão', () => {
  it('state → confirmar no navegador → trocar o código uma vez → /api/me → revogar', async () => {
    expect((await call('GET', '/api/device/state?state=abc')).data).toMatchObject({ ceremonyStatus: 'pending', loggedIn: false });
    expect((await call('GET', '/api/device/state?state=abc', { cookie: owner })).data).toMatchObject({ loggedIn: true, email: 'dono@acme.test', accessEnabled: true });
    const confirm = await call('POST', '/api/device/confirm', { cookie: owner, body: { state: 'abc' } });
    const code = new URL(confirm.data.redirectUri).searchParams.get('code')!;
    const { token } = (await call('POST', '/api/auth/device/exchange', { body: { code, label: 'VS Code do dono' } })).data;
    expect(token).toMatch(/^sde_/);
    expect((await call('POST', '/api/auth/device/exchange', { body: { code } })).status).toBe(400);
    expect((await call('GET', '/api/me', { token })).data).toMatchObject({ email: 'dono@acme.test', companyName: 'Acme' });

    const devices = (await call('GET', '/api/account', { cookie: owner })).data.devices;
    expect(devices.map((d: { label: string }) => d.label)).toContain('VS Code do dono');
    expect((await call('POST', '/api/auth/logout-device', { token })).status).toBe(200);
    expect((await call('GET', '/api/me', { token })).status).toBe(401);
  });
});

describe('painel do admin', () => {
  it('só o admin entra; visão geral, empresas, permissões e membros', async () => {
    expect((await call('GET', '/api/admin/overview', { cookie: owner })).status).toBe(403);
    const created = (await call('POST', '/api/admin/companies', { cookie: admin, body: { name: 'Beta', aiEnabled: true, ownerEmail: 'dona@beta.test', ownerPassword: PASSWORD } })).data;
    expect((await call('PATCH', `/api/admin/companies/${created.id}`, { cookie: admin, body: { name: 'Beta Ltda' } })).status).toBe(200);
    const perm = await call('PATCH', `/api/admin/companies/${created.id}/permissions`, { cookie: admin, body: { key: 'accessEnabled', value: false } });
    expect(perm.data.permissions).toEqual({ accessEnabled: false, aiEnabled: true });

    const list = (await call('GET', '/api/admin/companies', { cookie: admin })).data;
    expect(list.find((c: { id: number }) => c.id === created.id)).toMatchObject({ name: 'Beta Ltda', memberCount: 0, pendingCount: 1 });
    expect((await call('GET', '/api/admin/overview', { cookie: admin })).data).toMatchObject({ companies: 3, suspendedCompanies: 1, aiCompanies: 1, pendingInvites: 1 });
    expect((await call('GET', `/api/admin/companies/${created.id}/members`, { cookie: admin })).data).toEqual([
      expect.objectContaining({ email: 'dona@beta.test', role: 'owner', status: 'pending' }),
    ]);
    // a própria empresa do admin não pode ser suspensa
    expect((await call('PATCH', `/api/admin/companies/1/permissions`, { cookie: admin, body: { key: 'accessEnabled', value: false } })).status).toBe(400);
  });

  it('excluir empresa e usuário leva junto o que pertence a eles (transação)', async () => {
    const beta = (await call('POST', '/api/admin/companies', { cookie: admin, body: { name: 'Gama', ownerEmail: 'dono@gama.test', ownerPassword: PASSWORD } })).data;
    const gama = await login('dono@gama.test');
    // cerimônia confirmada: device_auth_requests aponta para o usuário, sem cascata
    expect((await call('GET', '/api/device/state?state=gama', { cookie: gama })).status).toBe(200);
    expect((await call('POST', '/api/device/confirm', { cookie: gama, body: { state: 'gama' } })).status).toBe(200);
    expect((await call('DELETE', `/api/admin/companies/${beta.id}`, { cookie: admin })).status).toBe(200);
    expect((await call('GET', '/api/account', { cookie: gama })).status).toBe(401);
    expect((await call('GET', '/api/admin/users', { cookie: admin })).data.map((u: { email: string }) => u.email)).not.toContain('dono@gama.test');

    const users = (await call('GET', '/api/admin/users', { cookie: admin })).data;
    const troca = users.find((u: { email: string }) => u.email === 'troca@acme.test');
    expect(troca).toMatchObject({ companyName: 'Acme' });
    expect((await call('POST', `/api/admin/users/${troca.id}/revoke-devices`, { cookie: admin })).data).toEqual({ ok: true, revoked: 0 });
    expect((await call('DELETE', `/api/admin/users/${troca.id}`, { cookie: admin })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { body: { email: 'troca@acme.test', password: 'Nova-Senha-22' } })).status).toBe(403);
  });
});
