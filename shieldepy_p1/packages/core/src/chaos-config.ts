// O contrato do projeto com os testes de caos (`shieldepy.chaos.config.ts`), lido pela AST — sem
// executar nada. Importar o config carregaria o app inteiro (e os aliases do projeto quebram fora
// do bundler dele). Só NOMES saem daqui: é o que o gerador de testes e a IA podem ver.

import { propertyKey } from './code-graph/extract-module';
import type { SyntaxNode } from './code-graph/parser';

export const CHAOS_CONFIG_FILE = 'shieldepy.chaos.config.ts';

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
