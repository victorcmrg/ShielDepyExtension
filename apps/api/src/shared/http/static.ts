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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};
// Imagens, vídeo e som mudam pouco: o navegador pode reaproveitar por um dia.
const IMAGE_CACHE = new Set(['.svg', '.webp', '.png', '.mp4', '.webm', '.mp3']);
// Mídia aceita pedido por faixa (Range): o <video> busca o começo e o resto por partes (o Safari só toca assim).
const RANGED = new Set(['.mp4', '.webm', '.mp3']);

/** A faixa pedida em `Range: bytes=…` (uma só), ou 'invalid' se não cabe no arquivo. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // bytes=-N: os últimos N
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
// /assets/* sai do Vite com hash no nome: o conteúdo nunca muda naquele endereço, cache "eterno".
const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.\w+$/;
// HTML sem cache: um deploy novo aponta pra outros /assets/ e precisa chegar na hora.
const HTML_CACHE = 'no-cache';

export function staticFiles(dir: string): (res: ServerResponse, url: URL, range?: string) => Promise<void> {
  const staticDir = path.resolve(dir);
  return async (res, url, rangeHeader) => {
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
    const headers = {
      ...SECURITY_HEADERS,
      'content-type': MIME[ext] ?? 'application/octet-stream',
      ...(cache ? { 'cache-control': cache } : {}),
      ...(RANGED.has(ext) ? { 'accept-ranges': 'bytes' } : {}),
    };
    const range = RANGED.has(ext) ? parseRange(rangeHeader, buf.length) : null;
    if (range === 'invalid') {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${buf.length}` });
      res.end();
      return;
    }
    if (range) {
      res.writeHead(206, { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${buf.length}`, 'content-length': String(range.end - range.start + 1) });
      res.end(buf.subarray(range.start, range.end + 1));
      return;
    }
    res.writeHead(200, headers);
    res.end(buf);
  };
}
