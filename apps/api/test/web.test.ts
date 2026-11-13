import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler } from '../src/app';
import { RateLimiter } from '../src/shared/http/rateLimiter';

let server: Server;
let base: string;
// Um "build" mínimo no lugar do dist/ do Vite: os testes não dependem de rodar o build antes.
const staticDir = mkdtempSync(join(tmpdir(), 'shieldepy-dist-'));
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>landing</title>');
writeFileSync(join(staticDir, 'app.html'), '<!doctype html><title>portal</title>');
mkdirSync(join(staticDir, 'assets'));
writeFileSync(join(staticDir, 'assets', 'app-B1x2Y3z4.js'), 'export {};');
mkdirSync(join(staticDir, 'video'));
writeFileSync(join(staticDir, 'video', 'entrar-h264.mp4'), '0123456789');

beforeAll(async () => {
  const handler = createHandler({ staticDir });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(staticDir, { recursive: true, force: true });
});

describe('a API não roda o motor (S3)', () => {
  it.each(['/analyze', '/chat'])('POST %s não existe mais → 405', async (url) => {
    const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"example":"node"}' });
    expect(res.status).toBe(405);
  });
});

describe('estático', () => {
  it('serve a página com CSP e bloqueia path traversal', async () => {
    const page = await fetch(base + '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect((await fetch(base + '/..%2f..%2fpackage.json')).status).toBe(403);
    expect((await fetch(base + '/nao-existe.js')).status).toBe(404);
  });

  it('rotas do portal caem no app.html; a landing é o index.html', async () => {
    expect(await (await fetch(base + '/')).text()).toContain('landing');
    for (const route of ['/projects', '/projects/7', '/login', '/device-confirm']) {
      const res = await fetch(base + route);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('portal');
    }
  });

  it('endereços .html antigos não redirecionam mais (S5): são arquivos que não existem', async () => {
    for (const old of ['/device-confirm.html?state=abc', '/project.html?id=12', '/projects.html']) {
      expect((await fetch(base + old, { redirect: 'manual' })).status).toBe(404);
    }
  });

  it('vídeo: tipo certo, cache de um dia e pedidos por faixa (Range), que o <video> usa', async () => {
    const full = await fetch(`${base}/video/entrar-h264.mp4`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(await full.text()).toBe('0123456789');

    const part = await fetch(`${base}/video/entrar-h264.mp4`, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(part.headers.get('content-length')).toBe('4');
    expect(await part.text()).toBe('2345');

    const open = await fetch(`${base}/video/entrar-h264.mp4`, { headers: { range: 'bytes=7-' } });
    expect(open.status).toBe(206);
    expect(await open.text()).toBe('789');
    const tail = await fetch(`${base}/video/entrar-h264.mp4`, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');

    const out = await fetch(`${base}/video/entrar-h264.mp4`, { headers: { range: 'bytes=20-30' } });
    expect(out.status).toBe(416);
    expect(out.headers.get('content-range')).toBe('bytes */10');
  });

  it('assets com hash ganham cache longo; HTML não', async () => {
    expect((await fetch(base + '/assets/app-B1x2Y3z4.js')).headers.get('cache-control')).toContain('immutable');
    expect((await fetch(base + '/projects')).headers.get('cache-control')).toBe('no-cache');
  });
});

describe('RateLimiter', () => {
  it('limite por janela', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect([rl.allow('ip'), rl.allow('ip'), rl.allow('ip')]).toEqual([true, true, false]);
    t = 1000;
    expect(rl.allow('ip')).toBe(true);
  });
});
