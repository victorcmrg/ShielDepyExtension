// Corpos mínimos (MVP6): o `--init` monta um corpo de exemplo para cada rota com corpo a partir das
// propriedades que a cadeia de handlers lê de `req.body` (o `bodyReads` de cada função, lido pela AST).
// Os valores saem do nome do campo; não há validação (zod/joi) nem tipo envolvido ainda. O corpo não é
// prova de nada: o bloco de controle do teste gerado é quem diz se ele é aceito (inválido não conta).

import type { CodeGraph } from './code-graph/CodeGraph';
import { isSymbolNode } from './code-graph/types';
import type { Route } from './topology/types';

/**
 * O que a cadeia de uma rota lê do corpo: os caminhos e as funções onde eles foram lidos. `paths` vazio:
 * a cadeia tem handlers do projeto e nenhum deles lê ou repassa o `req.body` (a rota não usa corpo).
 */
export interface RouteBodyReads {
  paths: string[];
  /** Os rótulos dos handlers que leram algo (`validateCheckout`), na ordem da cadeia. */
  from: string[];
}

/** Por id de rota (`POST /checkout`), o que os handlers dela leem de `req.body`. Fica de fora a rota em que não dá para saber (sem handler do projeto). */
export function routeBodyReads(graph: CodeGraph, routes: Route[]): Record<string, RouteBodyReads> {
  const out: Record<string, RouteBodyReads> = {};
  for (const route of routes) {
    const paths = new Set(out[route.id]?.paths ?? []);
    const from = [...(out[route.id]?.from ?? [])];
    // algum handler do projeto toca no corpo (lê ou repassa)? e há handler do projeto na cadeia?
    let touched = false;
    let own = false;
    for (const handler of route.handlers) {
      for (const id of handler.symbols) {
        const attrs = graph.nodeAttributes(id);
        if (!attrs || !isSymbolNode(attrs)) continue;
        own = true;
        if (attrs.bodyReads || attrs.bodyPasses) touched = true;
      }
      const read = handler.symbols.flatMap((id) => {
        const attrs = graph.nodeAttributes(id);
        if (!attrs || !isSymbolNode(attrs)) return [];
        return [...(attrs.bodyReads ?? []), ...passedReads(graph, id, attrs.file, attrs.bodyPasses ?? [])];
      });
      if (read.length === 0) continue;
      read.forEach((p) => paths.add(p));
      if (!from.includes(handler.label)) from.push(handler.label);
    }
    // `article` e `article.title` (o pedaço e o que o serviço lê dele): fica só o mais fundo
    const all = [...paths];
    if (all.length > 0) out[route.id] = { paths: all.filter((x) => !all.some((y) => y.startsWith(`${x}.`))).sort(), from };
    else if (own && !touched && !out[route.id]) out[route.id] = { paths: [], from: [] };
  }
  return out;
}

/**
 * Um nível para dentro: o handler passa um pedaço do corpo a outra função (`createArticle(req.body.article)`,
 * `createUser({ ...req.body.user })`), e quem lê os campos é ela. A chamada é a do grafo (a mesma posição),
 * e o que a função chamada lê do parâmetro naquela posição entra com o caminho do pedaço na frente.
 */
function passedReads(graph: CodeGraph, caller: string, file: string, passes: Array<{ line: number; column: number; index: number; path: string }>): string[] {
  if (passes.length === 0) return [];
  const sites = graph.callSitesIn(file).filter((s) => s.caller === caller);
  const out: string[] = [];
  for (const p of passes) {
    const site = sites.find((s) => s.line === p.line && s.column === p.column);
    const inner = (site?.outcome === 'resolved' || site?.outcome === 'heuristic' ? site.targets : []).flatMap((id) => {
      const attrs = graph.nodeAttributes(id);
      return attrs && isSymbolNode(attrs) ? attrs.paramReads?.[p.index] ?? [] : [];
    });
    out.push(...inner.map((q) => (p.path ? `${p.path}.${q}` : q)));
  }
  return out;
}

/** As palavras de um nome de campo, em minúsculas: `priceCents` → price, cents; `card_token` → card, token. */
export function words(name: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const c of name) {
    const upper = c !== c.toLowerCase();
    if (c === '_' || c === '-' || (upper && current !== '')) {
      if (current) out.push(current);
      current = c === '_' || c === '-' ? '' : c.toLowerCase();
    } else current += c.toLowerCase();
  }
  if (current) out.push(current);
  return out;
}

const NUMBER_WORDS = new Set(['quantity', 'qty', 'amount', 'count', 'quantidade', 'qtd', 'total', 'price', 'preco', 'valor', 'cents', 'age', 'idade', 'number', 'numero', 'size', 'limit', 'page', 'stock', 'estoque']);
const BOOLEAN_PREFIXES = new Set(['is', 'has', 'can', 'should']);
const BOOLEAN_WORDS = new Set(['active', 'ativo', 'enabled', 'admin', 'published', 'accepted', 'aceito']);

/** Um valor plausível para o campo, pelo nome. O controle do teste gerado confere se a rota aceita. */
export function sampleValue(field: string): unknown {
  const w = words(field);
  const last = w.at(-1) ?? '';
  const has = (...xs: string[]) => w.some((x) => xs.includes(x));
  if (last === 'id' || last === 'ids') return last === 'ids' ? ['1'] : '1';
  if (has('email', 'mail')) return 'teste@exemplo.com';
  if (has('password', 'senha', 'pass')) return 'Senha-forte-123';
  if (has('token')) return 'tok_test';
  if (has('url', 'link', 'site', 'website')) return 'https://exemplo.com';
  if (has('phone', 'telefone', 'celular')) return '11999999999';
  if (has('date', 'data') || last === 'at') return '2026-01-01T00:00:00.000Z';
  if (BOOLEAN_PREFIXES.has(w[0] ?? '') || has(...BOOLEAN_WORDS)) return true;
  if (has(...NUMBER_WORDS)) return 1;
  if (has('tags', 'items', 'itens', 'list', 'lista')) return [];
  return 'teste';
}

/** `['user.email', 'user.name', 'quantity', 'tags[]']` → `{ quantity: 1, tags: [], user: { email: ..., name: ... } }`. */
export function sampleBody(paths: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const path of [...paths].sort()) {
    const keys = path.split('.');
    let at = body;
    for (const key of keys.slice(0, -1)) {
      const next = at[key];
      at = (next && typeof next === 'object' && !Array.isArray(next) ? next : (at[key] = {})) as Record<string, unknown>;
    }
    const last = keys.at(-1)!;
    // `posts[]`: o campo é usado como lista (`posts.map(...)`)
    if (last.endsWith('[]')) at[last.slice(0, -2)] = [];
    else at[last] = sampleValue(last);
  }
  return body;
}
