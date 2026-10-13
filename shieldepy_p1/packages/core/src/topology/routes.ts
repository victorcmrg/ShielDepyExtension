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
  // `asyncHandler(async (req, res) => {})`: o embrulho só repassa; o handler é o callback de dentro
  if (arg.kind === 'call' && arg.functions?.length) return { symbols: arg.functions, label: `${arg.callee.join('.')}(<inline>)`, inline: true };
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

/** `post('/x', [auth, validate], create)`: a lista vale os middlewares dela, em ordem. */
const flat = (args: CallArg[]): CallArg[] => args.flatMap((a) => (a.kind === 'array' ? flat(a.items) : [a]));

/** `r.path` dentro de `routes.forEach((r) => ...)` → o valor de `path` no item; o resto fica como está. */
function itemArg(arg: CallArg, param: string, item: Record<string, CallArg>): CallArg {
  if (arg.kind !== 'name' || arg.chain[0] !== param) return arg;
  return arg.chain.length === 2 ? item[arg.chain[1]!] ?? { kind: 'other' } : { kind: 'other' };
}

/**
 * Registros num roteador que chega como parâmetro, sem tipo: `module.exports = function (app) { app.post(...) }`
 * chamado com `require('./routes/auth')(app)` (ou `authRoutes(app)`). O parâmetro vale o roteador que
 * cada chamador passa — inclusive outro parâmetro, que por sua vez veio de alguém. Sem chamador com
 * um roteador do express, o registro não conta (o parâmetro pode ser qualquer coisa).
 */
function routesOnParams(
  all: Array<{ file: string; site: CallSite }>,
  routers: Set<string>
): { sites: Array<{ file: string; site: CallSite; router: string }>; mounts: Mount[] } {
  const onParam = all.filter(
    ({ site }) => site.receiverParam !== undefined && site.outcome === 'unbound' && site.object?.length === 1 && (VERBS[site.name] || site.name === 'use' || site.name === 'route')
  );
  // chamador (função) → índice do parâmetro → chave do roteador-parâmetro
  const params = new Map<string, Map<number, string>>();
  for (const { file, site } of onParam) {
    const key = valueKey(site.receiverOrigin, site.object, site.caller, file);
    if (!key) continue;
    let byIndex = params.get(site.caller);
    if (!byIndex) params.set(site.caller, (byIndex = new Map()));
    byIndex.set(site.receiverParam!, key);
  }
  if (params.size === 0) return { sites: [], mounts: [] };

  // cada chamada da função que passa um valor no parâmetro é uma montagem sem prefixo, ali, naquela posição:
  // os middlewares que o app registrou antes dela valem para as rotas de dentro
  const mounts: Mount[] = [];
  for (const { file, site } of all) {
    if (site.outcome !== 'resolved') continue;
    for (const target of site.targets) {
      for (const [index, child] of params.get(target) ?? []) {
        const arg = site.args[index];
        const parent = arg?.kind === 'name' ? valueKey(arg.origin, arg.chain, site.caller, file) : undefined;
        if (parent) mounts.push({ file, line: site.line, column: site.column, parent, child, prefix: '' });
      }
    }
  }
  // só conta o parâmetro que chega, por alguma cadeia de chamadas, a um roteador do express
  const reaches = (key: string, seen: Set<string>): boolean =>
    routers.has(key) || (!seen.has(key) && mounts.some((m) => m.child === key && reaches(m.parent, new Set([...seen, key]))));
  const live = new Set([...params.values()].flatMap((byIndex) => [...byIndex.values()]).filter((k) => reaches(k, new Set())));
  const sites = onParam
    .map(({ file, site }) => ({ file, site, router: valueKey(site.receiverOrigin, site.object, site.caller, file)! }))
    .filter((s) => live.has(s.router));
  return { sites, mounts: mounts.filter((m) => live.has(m.child)) };
}

/** Todas as rotas Express do grafo, com o caminho completo e a cadeia de handlers em ordem. */
export function findExpressRoutes(graph: CodeGraph): RouteScan {
  const all: Array<{ file: string; site: CallSite }> = [];
  for (const file of graph.files()) for (const site of graph.callSitesIn(file)) all.push({ file, site });

  const sites: Array<{ file: string; site: CallSite; router: string }> = [];
  for (const { file, site } of all) {
    // receptor nomeado (`router.post`) ou cadeia sem nome (`Router().use(a).use(b)`, que tem `receiverOrigin`)
    if (!isExpress(site) || (!site.object && !site.receiverOrigin)) continue;
    const router = valueKey(site.receiverOrigin, site.object, site.caller, file);
    if (router) sites.push({ file, site, router });
  }
  const routers = new Set(sites.map((s) => s.router));
  const onParams = routesOnParams(all, routers);
  for (const s of onParams.sites) {
    sites.push(s);
    routers.add(s.router);
  }

  const registrations: Registration[] = [];
  const mounts: Mount[] = [...onParams.mounts];
  const middlewares: Middleware[] = [];
  const skipped: SkippedRoute[] = [];

  // `router.route('/x').get(a).post(b)`: cada verbo da cadeia registra no caminho da `.route()`. A cadeia
  // é identificada pela posição da chamada que a começa (o `receiverOrigin` `@linha:coluna` dos verbos).
  const routeChains = new Map<string, { router: string; path: string }>();
  for (const { file, site, router } of sites) {
    if (site.name !== 'route' || !site.object) continue;
    const first = site.args[0];
    if (first?.kind === 'string') routeChains.set(`${file}#@${site.line}:${site.column}`, { router, path: first.value });
    else skipped.push({ file, line: site.line, reason: 'route(): caminho não literal' });
  }

  for (const { file, site, router } of sites) {
    const pos: Position = { file, line: site.line, column: site.column };
    const method = VERBS[site.name];
    const chained = method && !site.object ? routeChains.get(router) : undefined;
    if (chained) {
      const handlers = flat(site.args).map((a) => handlerOf(graph, a)).filter((h): h is RouteHandler => !!h);
      registrations.push({ ...pos, router: chained.router, method: method!, path: chained.path, handlers });
      continue;
    }
    // `routes.forEach((r) => router.use(r.path, r.route))`: uma chamada por item da lista, com `r.x` trocado pelo valor do item
    const loop = site.loop;
    const runs = loop ? graph.arrayItems(loop.array).map((item) => site.args.map((a) => itemArg(a, loop.param, item))) : [site.args];
    for (const args of runs) {
      const [first, ...rest] = args;
      if (method) {
        // `app.get('env')` com um argumento só é leitura de configuração, não rota
        if (args.length < 2) continue;
        if (first?.kind !== 'string') {
          skipped.push({ ...pos, reason: `${method}: caminho não literal` });
          continue;
        }
        const handlers = flat(rest).map((a) => handlerOf(graph, a)).filter((h): h is RouteHandler => !!h);
        registrations.push({ ...pos, router, method, path: first.value, handlers });
      } else if (site.name === 'use') {
        const prefix = first?.kind === 'string' ? first.value : '';
        for (const arg of flat(first?.kind === 'string' ? rest : args)) {
          // `use('/x', router)` ou `use('/x', require('./routes/x'))`
          const child =
            arg.kind === 'name' ? valueKey(arg.origin, arg.chain, site.caller, file) : arg.kind === 'call' ? valueKey(arg.origin, undefined, site.caller, file) : undefined;
          if (child && routers.has(child)) {
            mounts.push({ ...pos, parent: router, child, prefix });
            continue;
          }
          const handler = handlerOf(graph, arg);
          if (handler) middlewares.push({ ...pos, router, prefix, handler: { ...handler, middleware: true } });
        }
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
