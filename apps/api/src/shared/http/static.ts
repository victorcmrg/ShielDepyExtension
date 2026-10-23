// Serve o build do Vite: "/" é a landing pré-renderizada, e qualquer caminho sem extensão é uma
// rota do portal (app.html; o React Router resolve).
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import * as path from 'node:path';
import { HttpError, SECURITY_HEADERS } from './http';

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

export function staticFiles(dir: string): (res: ServerResponse, url: URL) => Promise<void> {
  const staticDir = path.resolve(dir);
  return async (res, url) => {
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'caminho inválido');
    }
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
  };
}
