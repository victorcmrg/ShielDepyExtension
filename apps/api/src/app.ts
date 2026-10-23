// API da empresa — `node:http` nativo, zero framework. Serve o build do React (apps/web/dist:
// landing pré-renderizada + portal SPA) e as rotas /api/*. Não roda o motor (decisão 0008).

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { legacyRedirect } from './legacyRoutes';

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

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
// Imagens mudam pouco: o navegador pode reaproveitar por um dia.
const IMAGE_CACHE = new Set(['.svg', '.webp', '.png']);
// /assets/* sai do Vite com hash no nome: o conteúdo nunca muda naquele endereço, cache "eterno".
const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.\w+$/;
// HTML sem cache: um deploy novo aponta pra outros /assets/ e precisa chegar na hora.
const HTML_CACHE = 'no-cache';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // style-src/font-src liberam só o Google Fonts (Manrope/Inter/JetBrains Mono, mesmo
  // link exato do design system do site) — resto continua 'self' estrito.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

export interface AppDeps {
  /** Build do Vite: index.html (landing), app.html (portal), assets/ e o que veio de public/. */
  staticDir: string;
  log?: (message: string) => void;
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
  const log = deps.log ?? (() => {});
  const staticDir = path.resolve(deps.staticDir);

  async function serveStatic(res: ServerResponse, url: URL): Promise<void> {
    const legacy = legacyRedirect(url);
    if (legacy) {
      res.writeHead(301, { ...SECURITY_HEADERS, location: legacy });
      res.end();
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'caminho inválido');
    }
    // "/" é a landing; qualquer outro caminho sem extensão é uma rota do portal (o React Router resolve).
    if (rel === '/') rel = '/index.html';
    else if (!path.extname(rel)) rel = '/app.html';
    const filePath = path.resolve(staticDir, `.${rel}`);
    // Com separador: "/dist-malicioso" não passa como "/dist" (bug do MVP).
    if (!filePath.startsWith(staticDir + path.sep)) throw new HttpError(403, 'proibido');
    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch {
      throw new HttpError(404, 'não encontrado');
    }
    const ext = path.extname(filePath);
    const cache = HASHED_ASSET.test(rel)
      ? 'public, max-age=31536000, immutable'
      : ext === '.html'
        ? HTML_CACHE
        : IMAGE_CACHE.has(ext)
          ? 'public, max-age=86400'
          : undefined;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[ext] ?? 'application/octet-stream',
      ...(cache ? { 'cache-control': cache } : {}),
    });
    res.end(buf);
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
      if (req.method === 'GET') return await serveStatic(res, parsedUrl);
      throw new HttpError(405, 'método não permitido');
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
