// Rotas Express, lidas do grafo: uma rota é `.get/.post/...` num valor cujas chamadas resolvem
// para o pacote `express` — nunca qualquer método chamado `post`. Os prefixos vêm das montagens
// (`app.use('/api', router)`), seguindo `router` até onde ele é declarado (import, barrel).

import { CHAOS_CONFIG_FILE } from '../chaos-config';
import type { CodeGraph } from '../code-graph/CodeGraph';
import { isSymbolNode, type CallArg, type CallSite, type ReceiverCall, type ValueOrigin } from '../code-graph/types';
import type { ExpressApp, HttpMethod, Route, RouteHandler, RouteScan, SkippedRoute } from './types';

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

/** Pacotes de rotas por decorator: o controller dá o prefixo, o método dá o verbo e o caminho. */
const DECORATOR_PACKAGES = new Set(['routing-controllers', '@nestjs/common']);
const CONTROLLER_DECORATORS = new Set(['Controller', 'JsonController']);
const VERB_DECORATORS: Record<string, HttpMethod> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS', All: 'ALL' };

/**
 * Rotas declaradas por decorator (`routing-controllers` e NestJS): `@JsonController('/pets')` /
 * `@Controller('cats')` na classe e `@Get('/:id')` / `@Post()` no método. O handler é o próprio método;
 * o prefixo global do Nest (`app.setGlobalPrefix('api')`) entra quando é literal.
 */
function decoratorRoutes(graph: CodeGraph, all: Array<{ file: string; site: CallSite }>, skipped: SkippedRoute[]): Route[] {
  const fromPackage = (s: CallSite) => s.outcome === 'external' && DECORATOR_PACKAGES.has(s.package!);
  const pathArg = (s: CallSite): string | undefined => {
    const first = s.args[0];
    if (!first) return '';
    if (first.kind === 'string') return first.value;
    // `@Controller({ path: 'cats' })`
    const path = first.kind === 'object' ? first.texts?.path : undefined;
    return path?.kind === 'string' ? path.value : undefined;
  };
  const prefixes = new Map<string, string>();
  for (const { file, site } of all) {
    if (!site.decorates || !fromPackage(site) || !CONTROLLER_DECORATORS.has(site.name)) continue;
    const prefix = pathArg(site);
    if (prefix === undefined) skipped.push({ file, line: site.line, reason: `@${site.name}: caminho não literal` });
    else prefixes.set(site.decorates, prefix);
  }
  if (prefixes.size === 0) return [];
  const globalPrefix = all.find(({ site }) => site.name === 'setGlobalPrefix' && site.outcome === 'external' && site.args[0]?.kind === 'string')?.site.args[0];

  const routes: Route[] = [];
  for (const { file, site } of all) {
    const method = VERB_DECORATORS[site.name];
    if (!method || !site.decorates || !fromPackage(site)) continue;
    const attrs = graph.nodeAttributes(site.decorates);
    if (!attrs || !isSymbolNode(attrs) || attrs.kind !== 'method' || !attrs.container) continue;
    const prefix = prefixes.get(`${attrs.file}#${attrs.container}`);
    if (prefix === undefined) continue; // classe sem `@Controller` (ou com caminho não literal, já avisado)
    const path = pathArg(site);
    if (path === undefined) {
      skipped.push({ file, line: site.line, reason: `@${site.name}: caminho não literal` });
      continue;
    }
    const full = joinPath(joinPath(joinPath('', globalPrefix?.kind === 'string' ? globalPrefix.value : ''), prefix), path);
    routes.push({
      id: `${method} ${full}`,
      method,
      path: full,
      file,
      line: site.line,
      handlers: [{ symbols: [site.decorates], label: `${attrs.container}.${attrs.name}` }],
    });
  }
  return routes;
}

/** Todas as rotas Express do grafo, com o caminho completo e a cadeia de handlers em ordem. */
export function findExpressRoutes(graph: CodeGraph): RouteScan {
  const all: Array<{ file: string; site: CallSite }> = [];
  for (const file of graph.files()) {
    // o contrato do caos é arnês de teste: quando o `createApp` dele remonta os roteadores (app que
    // chama `listen` no topo), cada rota sairia duas vezes (C1, pg-crud). Ele continua no grafo.
    if (file.split(/[\\/]/).pop() === CHAOS_CONFIG_FILE) continue;
    for (const site of graph.callSitesIn(file)) all.push({ file, site });
  }

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
  // roteador raiz → as rotas que sobem até ele (o app, quando ele nasce de um `express()`)
  const rootRoutes = new Map<string, Set<string>>();
  for (const reg of registrations) {
    // Sobe da rota até a raiz pelas montagens: cada nível soma o prefixo e os middlewares registrados antes.
    const climb = (router: string, path: string, handlers: RouteHandler[], at: Position, seen: Set<string>) => {
      const mws = middlewares.filter((m) => m.router === router && before(m, at) && covers(m.prefix, path)).map((m) => m.handler);
      const chain = [...mws, ...handlers];
      const parents = mounts.filter((m) => m.child === router && !seen.has(m.parent));
      if (parents.length === 0) {
        routes.push({ id: `${reg.method} ${path}`, method: reg.method, path, file: reg.file, line: reg.line, handlers: chain });
        let ids = rootRoutes.get(router);
        if (!ids) rootRoutes.set(router, (ids = new Set()));
        ids.add(`${reg.method} ${path}`);
        return;
      }
      for (const m of parents) climb(m.parent, joinPath(m.prefix, path), chain, m, new Set([...seen, router]));
    };
    climb(reg.router, joinPath('', reg.path), reg.handlers, reg, new Set());
  }

  routes.push(...decoratorRoutes(graph, all, skipped));
  routes.push(...aspNetControllerRoutes(graph, all, skipped));
  routes.push(...minimalApiRoutes(graph, all, skipped));
  routes.push(...fastEndpointsRoutes(graph, all, skipped));
  routes.push(...springRoutes(graph, all, skipped));
  routes.sort((a, b) => cmp(a.path, b.path) || cmp(a.method, b.method) || cmp(a.file, b.file) || a.line - b.line);
  return { routes, skipped, apps: expressApps(graph, all, sites, mounts, rootRoutes) };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** O import do `express` por trás de `local` em `file`: o default do pacote (`import express`, `require('express')`). */
function expressImport(graph: CodeGraph, file: string, local: string) {
  const binding = graph.moduleInfoOf(file)?.imports.find((b) => b.local === local);
  return binding?.spec === 'express' && (binding.imported === 'default' || binding.imported === '*') ? binding : undefined;
}

/** `express()` — não `express.Router()`, `Router()` nem `json()`. */
const createsApp = (graph: CodeGraph, file: string, call: { name: string; object?: string[] }) => !call.object && !!expressImport(graph, file, call.name);

/**
 * Os apps Express (C2a): os roteadores raiz (não montados em ninguém) que nascem de um `express()`.
 * No topo do arquivo, o valor tem que vir do `express()` (`const app = express()`); dentro de uma
 * função, vale o roteador raiz da função que chama o `express()`. A fábrica (`export function
 * createApp() { const app = express(); ...; return app }`) só conta se a função devolve o app pelo nome.
 */
function expressApps(
  graph: CodeGraph,
  all: Array<{ file: string; site: CallSite }>,
  sites: Array<{ file: string; site: CallSite; router: string }>,
  mounts: Mount[],
  rootRoutes: Map<string, Set<string>>
): ExpressApp[] {
  const children = new Set(mounts.map((m) => m.child));
  // a declaração de cada roteador raiz: arquivo, nome e, se local, a função onde ele vive
  const roots = new Map<string, { file: string; name: string; caller?: string }>();
  for (const { file, site, router } of sites) {
    const origin = site.receiverOrigin;
    if (children.has(router) || roots.has(router) || !origin || site.receiverParam !== undefined) continue;
    roots.set(router, { file: origin.file, name: origin.name, ...(origin.local && { caller: site.caller }) });
  }
  const creations = all.filter(({ file, site }) => isExpress(site) && createsApp(graph, file, site));
  const used = new Set<CallSite>();

  const apps: ExpressApp[] = [];
  for (const [key, root] of roots) {
    const scope = root.caller ?? root.file;
    if (!root.caller) {
      const produced = graph.valueCallOf(root.file, root.name);
      if (!produced || !createsApp(graph, root.file, produced)) continue;
    }
    const creation = creations.find(({ file, site }) => file === root.file && site.caller === scope && !used.has(site));
    if (!creation) continue;
    used.add(creation.site);

    const exports = [...(graph.moduleInfoOf(root.file)?.exports ?? [])];
    const exportOf = (local: string) =>
      exports
        .filter(([, l]) => l === local)
        .map(([name]) => name)
        .sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : cmp(a, b)))[0];
    let exported: ExpressApp['exported'];
    if (!root.caller) {
      const name = exportOf(root.name);
      if (name) exported = { name, factory: false };
    } else {
      const fn = graph.nodeAttributes(root.caller);
      const name = fn && isSymbolNode(fn) && fn.kind === 'function' && fn.returnsNames?.includes(root.name) ? exportOf(fn.name) : undefined;
      if (name) exported = { name, factory: true };
    }

    const topLevel = (file: string, site: CallSite) => site.caller === file && !site.conditional;
    const listens = all
      .filter(({ site }) => site.name === 'listen' && !site.shadowed)
      .map(({ file, site }) => ({ file, site, onApp: isExpress(site) && valueKey(site.receiverOrigin, site.object, site.caller, file) === key }))
      .filter(({ file, site, onApp }) => onApp || (file === root.file && topLevel(file, site)))
      .map(({ file, site, onApp }) => ({ file, line: site.line, topLevel: topLevel(file, site), onApp }));
    apps.push({
      file: root.file,
      line: creation.site.line,
      commonjs: !!expressImport(graph, root.file, creation.site.name)?.require,
      ...(exported && { exported }),
      listens,
      routes: [...(rootRoutes.get(key) ?? [])].sort(),
    });
  }
  return apps.sort((a, b) => cmp(a.file, b.file) || a.line - b.line);
}

// ---------------------------------------------------------------------------------------------
// ASP.NET Core (etapa L3). Como no Express, um atributo de rota só conta se resolve para o pacote do
// ASP.NET Core, e um `MapGet` só se o receptor é dele — nunca qualquer método chamado `MapGet`.

const ASPNET_MVC = 'Microsoft.AspNetCore.Mvc';
const ASPNET_MINIMAL = new Set(['Microsoft.AspNetCore.Builder', 'Microsoft.AspNetCore.Routing']);
const VERB_ATTRIBUTES: Record<string, HttpMethod> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpPatch: 'PATCH',
  HttpDelete: 'DELETE',
  HttpHead: 'HEAD',
  HttpOptions: 'OPTIONS',
};
const MAP_VERBS: Record<string, HttpMethod> = { MapGet: 'GET', MapPost: 'POST', MapPut: 'PUT', MapPatch: 'PATCH', MapDelete: 'DELETE' };

/** Junta os segmentos com uma barra só, começando por `/`. */
function slashJoin(...parts: string[]): string {
  const segs = parts.flatMap((p) => p.split('/')).filter((seg) => seg !== '');
  return `/${segs.join('/')}`;
}

/** `api/[controller]` + `{id}` → `/api/checkout/{id}`; template do método com `/` ou `~/` no começo ignora o da classe. */
export function aspNetPath(prefix: string, template: string): string {
  if (template.startsWith('~/')) return slashJoin(template.slice(2));
  if (template.startsWith('/')) return slashJoin(template);
  return slashJoin(prefix, template);
}

/** Troca `[controller]` e `[action]` (sem diferenciar maiúscula) pelos nomes; `[[` e `]]` são colchetes literais. */
export function aspNetTokens(template: string, controller: string, action: string): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i]!;
    if ((c === '[' || c === ']') && template[i + 1] === c) {
      out += c;
      i++;
      continue;
    }
    const end = c === '[' ? template.indexOf(']', i) : -1;
    if (end < 0) {
      out += c;
      continue;
    }
    const token = template.slice(i + 1, end).toLowerCase();
    out += token === 'controller' ? controller : token === 'action' ? action : template.slice(i, end + 1);
    i = end;
  }
  return out;
}

/**
 * Rotas de controller: `[Route("api/[controller]")]` na classe e `[HttpGet("{id}")]` / `[HttpPost]` /
 * `[Route("x")]` no método. `[controller]` é o nome da classe sem `Controller`; `[action]` é o do método
 * sem `Async` (o padrão do ASP.NET Core). Um `[Route]` no método sem verbo aceita qualquer verbo (`ALL`).
 */
function aspNetControllerRoutes(graph: CodeGraph, all: Array<{ file: string; site: CallSite }>, skipped: SkippedRoute[]): Route[] {
  const attributes = all.filter(({ site }) => site.decorates && site.outcome === 'external' && site.package === ASPNET_MVC);
  if (attributes.length === 0) return [];
  const template = (site: CallSite): string | undefined => {
    const first = site.args[0];
    return !first ? '' : first.kind === 'string' ? first.value : undefined;
  };
  const kindOf = (id: string) => {
    const a = graph.nodeAttributes(id);
    return a && isSymbolNode(a) ? a : undefined;
  };

  const classRoutes = new Map<string, string[]>();
  const methodRoutes = new Map<string, Array<{ file: string; site: CallSite; template: string }>>();
  const methodVerbs = new Map<string, Array<{ file: string; site: CallSite; method: HttpMethod; template?: string }>>();
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const { file, site } of attributes) {
    const target = kindOf(site.decorates!);
    const verb = VERB_ATTRIBUTES[site.name];
    if (site.name !== 'Route' && !verb) continue;
    const t = template(site);
    if (t === undefined) {
      skipped.push({ file, line: site.line, reason: `[${site.name}]: caminho não literal` });
      continue;
    }
    if (target?.kind === 'class' && site.name === 'Route') push(classRoutes, site.decorates!, t);
    else if (target?.kind === 'method' && site.name === 'Route') push(methodRoutes, site.decorates!, { file, site, template: t });
    else if (target?.kind === 'method' && verb) push(methodVerbs, site.decorates!, { file, site, method: verb, ...(site.args.length > 0 && { template: t }) });
  }

  const routes: Route[] = [];
  for (const id of new Set([...methodVerbs.keys(), ...methodRoutes.keys()])) {
    const attrs = kindOf(id)!;
    const container = attrs.container ?? '';
    const controller = container.endsWith('Controller') && container.length > 'Controller'.length ? container.slice(0, -'Controller'.length) : container;
    const action = attrs.name.endsWith('Async') && attrs.name.length > 'Async'.length ? attrs.name.slice(0, -'Async'.length) : attrs.name;
    const prefixes = classRoutes.get(`${attrs.file}#${container}`) ?? [''];
    const own = methodRoutes.get(id) ?? [];
    const verbs = methodVerbs.get(id) ?? [];
    // cada verbo com o template dele; sem template, os `[Route]` do método (ou só o da classe)
    const combos: Array<{ method: HttpMethod; template: string; file: string; line: number }> = verbs.length
      ? verbs.flatMap((v) =>
          v.template !== undefined
            ? [{ method: v.method, template: v.template, file: v.file, line: v.site.line }]
            : own.length
              ? own.map((r) => ({ method: v.method, template: r.template, file: v.file, line: v.site.line }))
              : [{ method: v.method, template: '', file: v.file, line: v.site.line }]
        )
      : own.map((r) => ({ method: 'ALL' as const, template: r.template, file: r.file, line: r.site.line }));
    for (const combo of combos) {
      for (const prefix of prefixes) {
        const path = aspNetPath(aspNetTokens(prefix, controller, action), aspNetTokens(combo.template, controller, action));
        routes.push({
          id: `${combo.method} ${path}`,
          method: combo.method,
          path,
          file: combo.file,
          line: combo.line,
          handlers: [{ symbols: [id], label: `${container}.${attrs.name}` }],
        });
      }
    }
  }
  return routes;
}

/** Os prefixos dos `MapGroup("/x")` de onde o receptor veio, do mais externo ao mais interno; `undefined` se um não é literal. */
function groupPrefixes(call: ReceiverCall | undefined): string[] | undefined {
  const out: string[] = [];
  for (let rc = call; rc; rc = rc.receiverCall) {
    if (rc.name !== 'MapGroup') continue;
    const first = rc.args[0];
    if (first?.kind !== 'string') return undefined;
    out.unshift(first.value);
  }
  return out;
}

/** Minimal APIs: `app.MapGet("/x", handler)`, com o prefixo dos grupos (`var api = app.MapGroup("/api")`). */
function minimalApiRoutes(graph: CodeGraph, all: Array<{ file: string; site: CallSite }>, skipped: SkippedRoute[]): Route[] {
  const routes: Route[] = [];
  for (const { file, site } of all) {
    const method = MAP_VERBS[site.name];
    if (!method || site.outcome !== 'external' || !ASPNET_MINIMAL.has(site.package!)) continue;
    const [first, ...rest] = site.args;
    const prefixes = groupPrefixes(site.receiverCall);
    if (first?.kind !== 'string' || !prefixes) {
      skipped.push({ file, line: site.line, reason: `${site.name}: caminho não literal` });
      continue;
    }
    const path = slashJoin(...prefixes, first.value);
    const handlers = rest.map((a) => handlerOf(graph, a)).filter((h): h is RouteHandler => !!h);
    routes.push({ id: `${method} ${path}`, method, path, file, line: site.line, handlers });
  }
  return routes;
}

/** FastEndpoints: `Get("api/x")` / `Post(...)` (do pacote) dentro do `Configure()` da classe `X : Endpoint<Req, Res>`. */
const FAST_VERBS: Record<string, HttpMethod> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE' };
const FAST_HANDLERS = new Set(['HandleAsync', 'ExecuteAsync']);

function fastEndpointsRoutes(graph: CodeGraph, all: Array<{ file: string; site: CallSite }>, skipped: SkippedRoute[]): Route[] {
  const routes: Route[] = [];
  for (const { file, site } of all) {
    const method = FAST_VERBS[site.name];
    if (!method || site.outcome !== 'external' || site.package !== 'FastEndpoints' || site.object) continue;
    const configure = graph.nodeAttributes(site.caller);
    if (!configure || !isSymbolNode(configure) || configure.name !== 'Configure' || !configure.container) continue;
    // o handler é o `HandleAsync`/`ExecuteAsync` da mesma classe
    const handlers = graph.ownedSymbols(configure.file).filter((id) => {
      const m = graph.nodeAttributes(id);
      return m && isSymbolNode(m) && m.kind === 'method' && m.container === configure.container && FAST_HANDLERS.has(m.name);
    });
    const paths = site.args.filter((a) => a.kind === 'string');
    if (paths.length === 0 || paths.length !== site.args.length) {
      skipped.push({ file, line: site.line, reason: `${site.name}: caminho não literal` });
      continue;
    }
    for (const p of paths) {
      const path = slashJoin(p.kind === 'string' ? p.value : '');
      routes.push({ id: `${method} ${path}`, method, path, file, line: site.line, handlers: [{ symbols: handlers, label: `${configure.container}.${handlers.length ? graph.getLabel(handlers[0]!) : 'HandleAsync'}` }] });
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------------------------
// Spring MVC (etapa J2): `@RequestMapping` na classe e `@GetMapping`/`@PostMapping`/... ou
// `@RequestMapping(method = ...)` no método. Só conta a anotação que resolve para o pacote do Spring.

const SPRING_VERBS: Record<string, HttpMethod> = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE' };
const REQUEST_METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Os caminhos de uma anotação de rota: o valor posicional, ou `value`/`path`; texto ou lista. `undefined` = não literal. */
function springPaths(site: CallSite): string[] | undefined {
  const pairs = site.args.find((a) => a.kind === 'object');
  const raw = site.args.find((a) => a.kind !== 'object') ?? (pairs?.kind === 'object' ? pairs.values?.value ?? pairs.values?.path : undefined);
  if (!raw) return [''];
  const items = raw.kind === 'array' ? raw.items : [raw];
  const out: string[] = [];
  for (const i of items) {
    if (i.kind !== 'string') return undefined;
    out.push(i.value);
  }
  return out.length > 0 ? out : [''];
}

/** Os verbos de um `@RequestMapping(method = RequestMethod.POST)` (ou lista); sem `method`, qualquer um. */
function springMethods(site: CallSite): HttpMethod[] {
  const pairs = site.args.find((a) => a.kind === 'object');
  const raw = pairs?.kind === 'object' ? pairs.values?.method : undefined;
  if (!raw) return ['ALL'];
  const items = raw.kind === 'array' ? raw.items : [raw];
  const verbs = items.flatMap((i) => (i.kind === 'constant' && REQUEST_METHODS.has(i.chain.at(-1)!) ? [i.chain.at(-1)! as HttpMethod] : []));
  return verbs.length > 0 ? verbs : ['ALL'];
}

function springRoutes(graph: CodeGraph, all: Array<{ file: string; site: CallSite }>, skipped: SkippedRoute[]): Route[] {
  const annotations = all.filter(({ site }) => site.decorates && site.outcome === 'external' && site.package === 'spring-web');
  if (annotations.length === 0) return [];
  const attrsOf = (id: string) => {
    const a = graph.nodeAttributes(id);
    return a && isSymbolNode(a) ? a : undefined;
  };
  const classPrefixes = new Map<string, string[]>();
  for (const { file, site } of annotations) {
    if (site.name !== 'RequestMapping' || attrsOf(site.decorates!)?.kind !== 'class') continue;
    const paths = springPaths(site);
    if (paths) classPrefixes.set(site.decorates!, paths);
    else skipped.push({ file, line: site.line, reason: `@${site.name}: caminho não literal` });
  }
  const routes: Route[] = [];
  for (const { file, site } of annotations) {
    const method = attrsOf(site.decorates!);
    if (method?.kind !== 'method') continue;
    const verbs = SPRING_VERBS[site.name] ? [SPRING_VERBS[site.name]!] : site.name === 'RequestMapping' ? springMethods(site) : undefined;
    if (!verbs) continue;
    const paths = springPaths(site);
    if (!paths) {
      skipped.push({ file, line: site.line, reason: `@${site.name}: caminho não literal` });
      continue;
    }
    // o id da classe dona do método: arquivo#[de fora.]Classe
    const owner = graph.ownedSymbols(method.file).find((id) => {
      const c = attrsOf(id);
      return c?.kind === 'class' && c.name === method.container;
    });
    const prefixes = (owner && classPrefixes.get(owner)) ?? [''];
    for (const verb of verbs) {
      for (const prefix of prefixes) {
        for (const p of paths) {
          const path = slashJoin(prefix, p);
          routes.push({ id: `${verb} ${path}`, method: verb, path, file, line: site.line, handlers: [{ symbols: [site.decorates!], label: `${method.container}.${method.name}` }] });
        }
      }
    }
  }
  return routes;
}
