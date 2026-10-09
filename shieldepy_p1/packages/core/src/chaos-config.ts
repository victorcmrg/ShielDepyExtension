// O contrato do projeto com os testes de caos (`shieldepy.chaos.config.ts`), lido pela AST — sem
// executar nada. Importar o config carregaria o app inteiro (e os aliases do projeto quebram fora
// do bundler dele). Só NOMES saem daqui: é o que o gerador de testes e a IA podem ver.

import { propertyKey } from './code-graph/extract-module';
import type { SyntaxNode } from './code-graph/parser';
import type { AttackSurface } from './topology/surface';

export const CHAOS_CONFIG_FILE = 'shieldepy.chaos.config.ts';

/** Marca o que só o projeto sabe preencher no contrato gerado (`chaosConfigScaffold`): uma linha por pendência. */
export const CHAOS_CONFIG_TODO = 'TODO(shieldepy)';

/** Pendências que ainda restam no contrato: linhas com a marca. */
export function chaosConfigPending(source: string): number {
  return source.split('\n').filter((line) => line.includes(CHAOS_CONFIG_TODO)).length;
}

export interface ChaosConfigFacts {
  /** `createApp()` declarado (sem ele não há o que testar). */
  createApp: boolean;
  /** `reset()` declarado (sem ele, um teste contamina o próximo). */
  reset: boolean;
  /** Nomes das funções em `invariants`. */
  invariants: string[];
  /** Ids de rota com uma requisição válida em `requests` (`POST /checkout`). */
  requests: string[];
  /** Hosts com resposta saudável em `apis` (`api.stripe.com`). */
  apis: string[];
  /** Arquivos carregados antes de cada teste gerado. */
  setupFiles: string[];
}

/** Nomes dos membros de um objeto literal: `a`, `'b': x`, `c() {}`. */
function memberNames(object: SyntaxNode): string[] {
  const names: string[] = [];
  for (const m of object.namedChildren) {
    if (m.type === 'shorthand_property_identifier') names.push(m.text);
    else if (m.type === 'pair') {
      const key = propertyKey(m.childForFieldName('key'));
      if (key) names.push(key);
    } else if (m.type === 'method_definition') {
      const key = propertyKey(m.childForFieldName('name'));
      if (key) names.push(key);
    }
  }
  return names;
}

/** O valor de um membro do objeto (`requests: {...}` → o objeto; `reset() {}` → o próprio método). */
function member(object: SyntaxNode, name: string): SyntaxNode | undefined {
  for (const m of object.namedChildren) {
    if (m.type === 'pair' && propertyKey(m.childForFieldName('key')) === name) return m.childForFieldName('value') ?? undefined;
    if (m.type === 'method_definition' && propertyKey(m.childForFieldName('name')) === name) return m;
    if (m.type === 'shorthand_property_identifier' && m.text === name) return m;
  }
  return undefined;
}

/** O objeto exportado como default: `export default {…}`, `export default defineX({…})` ou `const c = {…}; export default c`. */
function defaultObject(root: SyntaxNode): SyntaxNode | undefined {
  const unwrap = (n: SyntaxNode | null | undefined): SyntaxNode | undefined => {
    if (!n) return undefined;
    if (n.type === 'object') return n;
    if (n.type === 'satisfies_expression' || n.type === 'as_expression' || n.type === 'parenthesized_expression') return unwrap(n.namedChildren[0]);
    if (n.type === 'call_expression') return unwrap(n.childForFieldName('arguments')?.namedChildren[0]);
    return undefined;
  };
  for (const stmt of root.namedChildren) {
    if (stmt.type !== 'export_statement' || stmt.childForFieldName('declaration')) continue;
    const value = stmt.childForFieldName('value');
    if (value?.type !== 'identifier') return unwrap(value);
    // `export default config` → a declaração `const config = …` no topo
    for (const decl of root.namedChildren) {
      if (decl.type !== 'lexical_declaration' && decl.type !== 'variable_declaration') continue;
      for (const d of decl.namedChildren) {
        if (d.type === 'variable_declarator' && d.childForFieldName('name')?.text === value.text) return unwrap(d.childForFieldName('value'));
      }
    }
  }
  return undefined;
}

/** Lê o contrato. `undefined` se o arquivo não exporta um objeto de config. */
export function readChaosConfig(root: SyntaxNode): ChaosConfigFacts | undefined {
  const config = defaultObject(root);
  if (!config) return undefined;
  const namesOf = (name: string) => {
    const v = member(config, name);
    return v?.type === 'object' ? memberNames(v) : [];
  };
  const setup = member(config, 'setupFiles');
  const setupFiles =
    setup?.type === 'array'
      ? setup.namedChildren.filter((s) => s.type === 'string').map((s) => propertyKey(s)).filter((s): s is string => !!s)
      : [];
  return {
    createApp: member(config, 'createApp') !== undefined,
    reset: member(config, 'reset') !== undefined,
    invariants: namesOf('invariants'),
    requests: namesOf('requests'),
    apis: namesOf('apis'),
    setupFiles,
  };
}

/** String TS entre aspas simples. */
const quoted = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** `/orders/:id` → `/orders/1`: um valor de exemplo no lugar de cada parâmetro do Express. */
const samplePath = (routePath: string) =>
  routePath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '1' : segment === '*' ? 'x' : segment))
    .join('/');

const WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * O contrato inicial (`shieldepy.chaos.config.ts`) a partir do mapa: uma requisição por rota
 * sensível e uma resposta saudável por API externa que elas chamam. O que o mapa não sabe (subir o
 * app, zerar o estado, as invariantes, corpos válidos) sai marcado com `CHAOS_CONFIG_TODO`. O
 * arquivo compila como está: `createApp` lança um erro claro até ser preenchido.
 */
export function chaosConfigScaffold(surface: AttackSurface): string {
  const hosts = [...new Set(surface.routes.flatMap((r) => r.operations.filter((o) => o.kind === 'api_call' && o.target !== 'dynamic').map((o) => o.target)))].sort();
  const routes = [...surface.routes].sort((a, b) => a.id.localeCompare(b.id));
  const T = CHAOS_CONFIG_TODO;

  const apis = hosts.length
    ? hosts.map((h) => `    ${quoted(h)}: () => ({}), // ${T}: a resposta de sucesso desta API`)
    : ['    // nenhuma API externa nas rotas sensíveis'];
  const requests = routes.length
    ? routes.map((r) => {
        const sample = samplePath(r.path);
        const fields = [`path: ${quoted(sample)}`, ...(WITH_BODY.has(r.method) ? ['body: {}'] : [])];
        const todo = WITH_BODY.has(r.method) ? `${T}: um corpo válido` : sample !== r.path ? `${T}: confira o parâmetro` : 'pronta';
        return `    ${quoted(r.id)}: { ${fields.join(', ')} }, // ${todo} (${r.at})`;
      })
    : ['    // nenhuma rota sensível no mapa: não há o que testar ainda'];

  return [
    '// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.',
    '// Os testes de caos saem da topologia, mas só o projeto sabe: como subir o app sem abrir porta,',
    '// como zerar o estado, o que nunca pode acontecer e como é uma requisição válida de cada rota.',
    '// Complete as linhas marcadas abaixo (uma marca por pendência) e rode "ShielDepy: Testar Caos"',
    '// (ou `shieldepy chaos .`). As invariantes são opcionais, mas são elas que provam corrida e estado.',
    '',
    'export default {',
    '  /** Monta o app SEM abrir porta (os testes usam supertest): importe e chame a fábrica do seu app. */',
    '  createApp: (): never => {',
    `    throw new Error('${T}: preencha createApp no ${CHAOS_CONFIG_FILE}');`,
    '  },',
    '  /** Carregados antes de cada teste gerado (ex.: trocar o banco por um em memória). */',
    '  setupFiles: [],',
    '  /** Estado limpo antes de cada teste. */',
    `  async reset(): Promise<void> {}, // ${T}: zere o banco ou o estado em memória (ou apague esta marca se não há estado)`,
    '  /** O que nunca pode acontecer: cada função devolve true quando está tudo certo. */',
    '  invariants: {',
    '    // ex.: async estoqueNuncaNegativo() { return (await menorEstoque()) >= 0; },',
    '  },',
    '  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */',
    '  apis: {',
    ...apis,
    '  },',
    '  /** Uma requisição válida por rota sensível (o id é o da topologia). */',
    '  requests: {',
    ...requests,
    '  },',
    '};',
    '',
  ].join('\n');
}
