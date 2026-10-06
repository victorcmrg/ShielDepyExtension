// Servidor web do ShielDepy — `node:http` nativo, zero framework. Serve a página estática e
// expõe /analyze (roda o motor) e /chat (conversa ancorada). A chave da IA fica SÓ aqui.

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { buildGraph, findCollisions } from '@shieldepy/core';
import { collisionChatReply, explainCollisions, type LLMProvider, type Logger } from '@shieldepy/agent';
import { loadRulesFromFiles, loadRulesFromPath, type Registry, type SourceFile } from '@shieldepy/extractors';
import { RateLimiter, SessionStore } from './sessions';

// Import tardio (só quando uma /api/* de verdade chega): node:sqlite é um builtin
// recente demais pra alguns pipelines de transform de teste reconhecerem no grafo
// estático de import — carregar sob demanda evita puxar auth/db.ts (e node:sqlite)
// pra dentro de suites que nunca tocam em rota nenhuma de autenticação.
let authRoutes: typeof import('./auth/routes') | undefined;
async function getAuthRoutes(): Promise<typeof import('./auth/routes')> {
  authRoutes ??= await import('./auth/routes');
  return authRoutes;
}

const MAX_BODY = 5_000_000; // 5 MB
const MAX_FILES = 50;
const MAX_MESSAGE = 4000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};
// Imagens mudam pouco: o navegador pode reaproveitar por um dia. HTML/CSS/JS seguem sem cache explícito.
const IMAGE_CACHE = new Set(['.svg', '.webp', '.png']);

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // style-src/font-src liberam só o Google Fonts (Manrope/Inter/JetBrains Mono, mesmo
  // link exato do design system do site) — resto continua 'self' estrito.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

/** Exemplos que a UI oferece — allowlist: o nome vindo do navegador nunca vira caminho nem conexão de banco. */
export const EXAMPLES: Record<string, string> = {
  node: 'pedidos-microservices/services',
  java: 'pedidos-spring/services',
  python: 'pedidos-django/services',
  csharp: 'pedidos-mediatr/services',
};

export interface AppDeps {
  registry: Registry;
  provider: LLMProvider | undefined;
  publicDir: string;
  examplesDir: string;
  sessions?: SessionStore;
  limiter?: RateLimiter;
  log?: Logger;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function createHandler(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const sessions = deps.sessions ?? new SessionStore();
  const limiter = deps.limiter ?? new RateLimiter();
  const log = deps.log ?? (() => {});
  const publicDir = path.resolve(deps.publicDir);

  async function analyze(body: Record<string, unknown>) {
    let loaded;
    if (typeof body.example === 'string') {
      const rel = EXAMPLES[body.example];
      if (!rel) throw new HttpError(400, `exemplo desconhecido: use ${Object.keys(EXAMPLES).join(', ')}`);
      loaded = loadRulesFromPath(path.join(deps.examplesDir, rel), deps.registry);
    } else if (Array.isArray(body.files) && body.files.length > 0) {
      if (body.files.length > MAX_FILES) throw new HttpError(400, `no máximo ${MAX_FILES} arquivos por análise`);
      const files: SourceFile[] = body.files.map((f: unknown, i: number) => {
        const file = f as { name?: unknown; content?: unknown };
        if (typeof file?.name !== 'string' || typeof file.content !== 'string') throw new HttpError(400, `arquivo ${i}: envie { name, content }`);
        return { name: path.basename(file.name), content: file.content };
      });
      loaded = loadRulesFromFiles(files, deps.registry);
    } else {
      throw new HttpError(400, "envie 'files' (arquivos) ou 'example' (um exemplo pronto)");
    }

    const collisions = findCollisions(buildGraph(loaded.rules));
    const report = await explainCollisions(collisions, loaded.rules, deps.provider, { log });
    const sessionId = sessions.create(collisions, loaded.rules);
    return { sessionId, report, factsCount: collisions.length, label: loaded.label, skipped: loaded.skipped };
  }

  async function chat(body: Record<string, unknown>) {
    const { sessionId, message } = body;
    if (typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) throw new HttpError(400, "envie 'sessionId' e 'message'");
    if (message.length > MAX_MESSAGE) throw new HttpError(400, `mensagem longa demais (máx. ${MAX_MESSAGE} caracteres)`);
    const session = sessions.get(sessionId);
    if (!session) throw new HttpError(404, 'sessão não encontrada ou expirada — analise um sistema primeiro');

    const result = await collisionChatReply({ collisions: session.collisions, rules: session.rules }, session.history, message, deps.provider, { log });
    sessions.append(sessionId, { role: 'user', content: message }, { role: 'assistant', content: result.reply });
    return result;
  }

  async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
    let rel: string;
    try {
      rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
    } catch {
      throw new HttpError(400, 'caminho inválido');
    }
    const filePath = path.resolve(publicDir, `.${rel}`);
    // Com separador: "/public-malicioso" não passa como "/public" (bug do MVP).
    if (!filePath.startsWith(publicDir + path.sep)) throw new HttpError(403, 'proibido');
    try {
      const buf = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': MIME[ext] ?? 'application/octet-stream',
        ...(IMAGE_CACHE.has(ext) ? { 'cache-control': 'public, max-age=86400' } : {}),
      });
      res.end(buf);
    } catch {
      throw new HttpError(404, 'não encontrado');
    }
  }

  return async (req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
      const url = parsedUrl.pathname;

      if (url.startsWith('/api/')) {
        const { handleAuthRoute } = await getAuthRoutes();
        const handled = await handleAuthRoute(req, res, url, parsedUrl);
        if (handled) return;
        throw new HttpError(404, 'rota não encontrada');
      }
      if (req.method === 'GET') return await serveStatic(res, url);
      if (req.method !== 'POST' || (url !== '/analyze' && url !== '/chat')) throw new HttpError(405, 'método não permitido');

      if (!limiter.allow(req.socket.remoteAddress ?? 'desconhecido')) throw new HttpError(429, 'muitas requisições — espere um minuto');
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(await readBody(req));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
        body = parsed;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, 'corpo da requisição não é um JSON válido');
      }
      sendJson(res, 200, url === '/analyze' ? await analyze(body) : await chat(body));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log(`[web] erro inesperado: ${err instanceof Error ? err.stack : err}`);
      // 500 não devolve a mensagem interna — pode vazar caminho/estado do servidor.
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'erro interno' : (err as Error).message });
      else res.end();
    }
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload muito grande (máx. 5 MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
