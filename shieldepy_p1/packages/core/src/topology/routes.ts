// Rotas Express, lidas do grafo: uma rota é `.get/.post/...` num valor cujas chamadas resolvem
// para o pacote `express` — nunca qualquer método chamado `post`. Os prefixos vêm das montagens
// (`app.use('/api', router)`), seguindo `router` até onde ele é declarado (import, barrel).

import type { CodeGraph } from '../code-graph/CodeGraph';
import { isSymbolNode, type CallArg, type CallSite, type ValueOrigin } from '../code-graph/types';
import type { HttpMethod, Route, RouteHandler, RouteScan, SkippedRoute } from './types';

const VERBS: Record<string, HttpMethod> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  head: 'HEAD',
  options: 'OPTIONS',
  all: 'ALL',
};

/** Posição de uma chamada: só se compara dentro do mesmo arquivo (a ordem entre arquivos é de runtime). */
interface Position {
  file: string;
  line: number;
  column: number;
}

interface Registration extends Position {
  router: string;
  method: HttpMethod;
  path: string;
  handlers: RouteHandler[];
}

interface Mount extends Position {
  parent: string;
  child: string;
  prefix: string;
}

interface Middleware extends Position {
  router: string;
  prefix: string;
  handler: RouteHandler;
}

const isExpress = (c: CallSite) => c.outcome === 'external' && c.package === 'express';

const before = (a: Position, b: Position) => a.file === b.file && (a.line < b.line || (a.line === b.line && a.column < b.column));

/** Identidade de um roteador: onde o valor é declarado; `this.router` vale dentro do arquivo. */
function valueKey(origin: ValueOrigin | undefined, chain: string[] | undefined, caller: string, file: string): string | undefined {
  if (origin) return origin.local ? `${origin.file}#${caller}#${origin.name}` : `${origin.file}#${origin.name}`;
  if (chain?.[0] === 'this') return `${file}#${chain.join('.')}`;
  return undefined;
}

/** `/api` + `/orders` → `/api/orders`; `/api` + `/` → `/api`. */
export function joinPath(prefix: string, path: string): string {
  const head = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (path === '' || path === '/') return head === '' ? '/' : head;
  return head + (path.startsWith('/') ? path : `/${path}`);
}

/** O middleware de `use(prefix, mw)` roda para `path` (relativo ao mesmo roteador)? */
function covers(prefix: string, path: string): boolean {
  if (prefix === '' || prefix === '/') return true;
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return path === p || path.startsWith(`${p}/`);
}

function handlerOf(graph: CodeGraph, arg: CallArg): RouteHandler | undefined {
  if (arg.kind === 'function') return { symbols: arg.symbolId ? [arg.symbolId] : [], label: '<inline>', inline: true };
  if (arg.kind === 'call') return { symbols: [], label: `${arg.callee.join('.')}()`, opaque: true };
  if (arg.kind === 'other') return { symbols: [], label: '<expressão>', opaque: true };
  if (arg.kind !== 'name') return undefined;
  const label = arg.chain.join('.');
  if (arg.outcome === 'external') return { symbols: [], label, ...(arg.package && { package: arg.package }) };
  const callable = arg.targets.filter((id) => {
    const attrs = graph.nodeAttributes(id);
    return attrs && isSymbolNode(attrs) && (attrs.kind === 'function' || attrs.kind === 'method');
  });
  if (callable.length === 0) return { symbols: [], label, opaque: true };
  return { symbols: callable, label, ...(arg.outcome === 'heuristic' && { heuristic: true }) };
}

/** Todas as rotas Express do grafo, com o caminho completo e a cadeia de handlers em ordem. */
export function findExpressRoutes(graph: CodeGraph): RouteScan {
  const sites: Array<{ file: string; site: CallSite; router: string }> = [];
  for (const file of graph.files()) {
    for (const site of graph.callSitesIn(file)) {
      if (!isExpress(site) || !site.object) continue;
      const router = valueKey(site.receiverOrigin, site.object, site.caller, file);
      if (router) sites.push({ file, site, router });
    }
  }
  const routers = new Set(sites.map((s) => s.router));

  const registrations: Registration[] = [];
  const mounts: Mount[] = [];
  const middlewares: Middleware[] = [];
  const skipped: SkippedRoute[] = [];

  for (const { file, site, router } of sites) {
    const pos: Position = { file, line: site.line, column: site.column };
    const [first, ...rest] = site.args;
    const method = VERBS[site.name];
    if (method) {
      // `app.get('env')` com um argumento só é leitura de configuração, não rota
      if (site.args.length < 2) continue;
      if (first?.kind !== 'string') {
        skipped.push({ ...pos, reason: `${method}: caminho não literal` });
        continue;
      }
      const handlers = rest.map((a) => handlerOf(graph, a)).filter((h): h is RouteHandler => !!h);
      registrations.push({ ...pos, router, method, path: first.value, handlers });
    } else if (site.name === 'use') {
      const prefix = first?.kind === 'string' ? first.value : '';
      for (const arg of first?.kind === 'string' ? rest : site.args) {
        const child = arg.kind === 'name' ? valueKey(arg.origin, arg.chain, site.caller, file) : undefined;
        if (child && routers.has(child)) {
          mounts.push({ ...pos, parent: router, child, prefix });
          continue;
        }
        const handler = handlerOf(graph, arg);
        if (handler) middlewares.push({ ...pos, router, prefix, handler: { ...handler, middleware: true } });
      }
    }
  }

  const routes: Route[] = [];
  for (const reg of registrations) {
    // Sobe da rota até a raiz pelas montagens: cada nível soma o prefixo e os middlewares registrados antes.
    const climb = (router: string, path: string, handlers: RouteHandler[], at: Position, seen: Set<string>) => {
      const mws = middlewares.filter((m) => m.router === router && before(m, at) && covers(m.prefix, path)).map((m) => m.handler);
      const chain = [...mws, ...handlers];
      const parents = mounts.filter((m) => m.child === router && !seen.has(m.parent));
      if (parents.length === 0) {
        routes.push({ id: `${reg.method} ${path}`, method: reg.method, path, file: reg.file, line: reg.line, handlers: chain });
        return;
      }
      for (const m of parents) climb(m.parent, joinPath(m.prefix, path), chain, m, new Set([...seen, router]));
    };
    climb(reg.router, joinPath('', reg.path), reg.handlers, reg, new Set());
  }

  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method) || cmp(a.file, b.file) || a.line - b.line);
  return { routes, skipped };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
