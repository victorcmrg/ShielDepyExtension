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
