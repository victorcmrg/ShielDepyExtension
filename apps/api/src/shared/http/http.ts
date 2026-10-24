// O que toda rota HTTP da API usa: erro com status, resposta JSON, leitura do corpo e os
// cabeçalhos de segurança. Sem framework: `node:http` nativo.
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY = 5_000_000; // 5 MB

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // style-src/font-src liberam só o Google Fonts (Manrope/Inter/JetBrains Mono, mesmo
  // link exato do design system do site) — resto continua 'self' estrito.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

/** Uma rota: método, padrão do caminho (os grupos viram `params`) e o handler. */
export type Route = [
  method: string,
  pattern: RegExp,
  handler: (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => void | Promise<void>,
];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** O corpo como JSON; corpo quebrado vira 400. */
export async function readJson<T>(req: IncomingMessage): Promise<T> {
  try {
    return JSON.parse(await readBody(req)) as T;
  } catch {
    throw new HttpError(400, 'corpo da requisição inválido');
  }
}

/** Texto de formulário: aparado, obrigatório ou não, com tamanho máximo. */
export function cleanText(raw: unknown, max: number, field: string, required: boolean): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (required && !value) throw new HttpError(400, `preencha ${field}`);
  if (value.length > max) throw new HttpError(400, `${field} longo demais (máx. ${max})`);
  return value;
}

/** Procura a rota do método e do caminho e chama; `false` se nenhuma casou. */
export async function dispatch(routes: Route[], req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  for (const [routeMethod, pattern, handler] of routes) {
    if (routeMethod !== method) continue;
    const match = pathname.match(pattern);
    if (!match) continue;
    await handler(req, res, match.slice(1), url);
    return true;
  }
  return false;
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
