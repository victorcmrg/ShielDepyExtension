import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TsParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { createRegistry } from '@shieldepy/extractors';
import { createHandler } from '../src/app';
import { RateLimiter, SessionStore } from '../src/sessions';

let server: Server;
let base: string;

beforeAll(async () => {
  const handler = createHandler({
    registry: createRegistry({ tsParser: await TsParser.load(defaultWasmDir()) }),
    provider: undefined, // offline: determinístico, sem rede
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    examplesDir: fileURLToPath(new URL('../../../examples', import.meta.url)),
    limiter: new RateLimiter(1000),
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (url: string, body: unknown) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('POST /analyze', () => {
  it.each(['node', 'java', 'python', 'csharp'])('exemplo %s → 3 colisões + sessão de chat', async (example) => {
    const res = await post('/analyze', { example });
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.factsCount).toBe(3);
    expect(data.report.engine).toBe('offline');
    expect(typeof data.sessionId).toBe('string');
  });

  it('upload de TS usa o extrator Tree-sitter (alias pega a escrita que o regex perdia)', async () => {
    const res = await post('/analyze', {
      files: [
        { name: 'desconto.ts', content: "bus.on('pedido.atualizado', (p) => { p.total = p.subtotal * 0.9; });" },
        { name: 'imposto.ts', content: "bus.on('pedido.atualizado', (pedido) => { const q = pedido; q.total = q.subtotal * 1.1; });" },
        { name: 'notas.txt', content: 'x' },
        { name: 'ruim.json', content: '[{"id":"x"}]' },
      ],
    });
    const data = (await res.json()) as any;
    expect(data.factsCount).toBe(1);
    expect(data.skipped).toEqual(['notas.txt (extensão não suportada)', 'ruim.json (regra 0: campo "resource" ausente ou inválido)']);
  });

  it.each([
    ['JSON quebrado', '{oops', 400],
    ['exemplo fora da allowlist (ex.: pg)', { example: 'pg' }, 400],
    ['corpo sem nada', {}, 400],
    ['arquivo sem conteúdo', { files: [{ name: 'a.ts' }] }, 400],
  ])('%s → %i', async (_label, body, status) => {
    const res = await post('/analyze', body);
    expect(res.status).toBe(status);
    expect(((await res.json()) as any).error).toBeTruthy();
  });
});

describe('POST /chat', () => {
  it('responde ancorado na sessão (offline) e 404 pra sessão desconhecida', async () => {
    const { sessionId } = (await (await post('/analyze', { example: 'java' })).json()) as any;
    const ok = (await (await post('/chat', { sessionId, message: 'por que total é crítico?' })).json()) as any;
    expect(ok.engine).toBe('offline');
    expect(ok.reply).toMatch(/provou 3 colisão/);

    expect((await post('/chat', { sessionId: 'nao-existe', message: 'oi' })).status).toBe(404);
    expect((await post('/chat', { sessionId, message: 'x'.repeat(5000) })).status).toBe(400);
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
});

describe('SessionStore / RateLimiter', () => {
  it('sessão expira pelo TTL e o histórico tem teto', () => {
    let t = 0;
    const store = new SessionStore({ ttlMs: 1000, maxSessions: 2, maxHistory: 3 }, () => t);
    const id = store.create([], []);
    store.append(id, ...Array.from({ length: 5 }, (_, i) => ({ role: 'user' as const, content: String(i) })));
    expect(store.get(id)!.history.map((m) => m.content)).toEqual(['2', '3', '4']);
    t = 5000;
    expect(store.get(id)).toBeUndefined();
  });

  it('limite por janela', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect([rl.allow('ip'), rl.allow('ip'), rl.allow('ip')]).toEqual([true, true, false]);
    t = 1000;
    expect(rl.allow('ip')).toBe(true);
  });
});
