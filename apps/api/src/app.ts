// API da empresa — `node:http` nativo, zero framework. Monta o servidor: o build do React
// (apps/web/dist) e as rotas /api/* de cada domínio. Não roda o motor (decisão 0008).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sendJson } from './shared/http/http';
import { staticFiles } from './shared/http/static';

// Import tardio (só quando uma /api/* de verdade chega): node:sqlite é um builtin
// recente demais pra alguns pipelines de transform de teste reconhecerem no grafo
// estático de import — carregar sob demanda evita puxar o banco (e node:sqlite)
// pra dentro de suites que nunca tocam em rota nenhuma de autenticação.
let composition: typeof import('./composition') | undefined;
async function getComposition(): Promise<typeof import('./composition')> {
  composition ??= await import('./composition');
  return composition;
}

export interface AppDeps {
  /** Build do Vite: index.html (landing), app.html (portal), assets/ e o que veio de public/. */
  staticDir: string;
  log?: (message: string) => void;
}

export function createHandler(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const log = deps.log ?? (() => {});
  const serveStatic = staticFiles(deps.staticDir);

  return async (req, res) => {
    try {
      const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
      const url = parsedUrl.pathname;

      if (url.startsWith('/api/')) {
        const { handleApiRoute } = await getComposition();
        const handled = await handleApiRoute(req, res, url, parsedUrl);
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
