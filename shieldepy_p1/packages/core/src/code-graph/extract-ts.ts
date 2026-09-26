// Leitura da árvore Tree-sitter de um arquivo TS/JS: símbolos, imports e chamadas.
// Funções puras — não sabem nada do grafo; o CodeGraph decide o que fazer com o resultado.

import type { SyntaxNode } from './parser';
import type { SymbolKind } from './types';

export interface SymbolInfo {
  id: string;
  kind: SymbolKind;
  name: string;
  startLine: number;
  endLine: number;
  /** Lista de parâmetros (texto literal, ex: "(a: string, b: number)"). */
  signature?: string;
  /** Offsets de caractere — atribuir chamada por linha não separa duas arrow functions na mesma linha. */
  startIndex: number;
  endIndex: number;
}

/** Uma chamada ainda por NOME: o CodeGraph resolve pra um símbolo depois (e religa quando o alvo muda). */
export type RawCall = [callerId: string, calleeName: string];

const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function']);

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** Funções, métodos, classes, e `const f = () => {}` / campo de classe `handle = () => {}`. */
export function extractSymbols(root: SyntaxNode, fileId: string): SymbolInfo[] {
  const results: SymbolInfo[] = [];

  const push = (node: SyntaxNode, kind: SymbolKind, name: string, fn: SyntaxNode) => {
    const paramsNode = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
    results.push({
      id: `${fileId}#${name}:${node.startPosition.row}`,
      kind,
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: paramsNode?.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    });
  };

  walk(root, (node) => {
    if (node.type === 'function_declaration' || node.type === 'method_definition' || node.type === 'class_declaration') {
      const name = node.childForFieldName('name')?.text ?? '<anonymous>';
      const kind = node.type === 'class_declaration' ? 'class' : node.type === 'method_definition' ? 'method' : 'function';
      push(node, kind, name, node);
    } else if (node.type === 'variable_declarator' || node.type === 'public_field_definition') {
      const value = node.childForFieldName('value');
      const name = node.childForFieldName('name')?.text;
      if (name && value && FUNCTION_VALUE_TYPES.has(value.type)) {
        push(node, node.type === 'public_field_definition' ? 'method' : 'function', name, value);
      }
    }
  });

  return results;
}

/** Especificadores RELATIVOS de `import`/`export ... from` (`./b`, `../lib`). Pacotes são ignorados. */
export function extractImportSpecs(root: SyntaxNode): string[] {
  const specs: string[] = [];
  walk(root, (node) => {
    if (node.type !== 'import_statement' && node.type !== 'export_statement') return;
    const sourceNode = node.childForFieldName('source') ?? node.namedChildren.find((c) => c.type === 'string');
    const source = sourceNode?.text.replace(/^['"]|['"]$/g, '');
    if (source?.startsWith('.')) specs.push(source);
  });
  return specs;
}

/** Cada chamada atribuída ao símbolo MAIS INTERNO que a contém (método, não a classe). */
export function extractCalls(root: SyntaxNode, symbols: SymbolInfo[]): RawCall[] {
  const enclosing = (index: number): string | undefined => {
    let best: SymbolInfo | undefined;
    for (const s of symbols) {
      if (index < s.startIndex || index >= s.endIndex) continue;
      if (!best || s.endIndex - s.startIndex < best.endIndex - best.startIndex) best = s;
    }
    return best?.id;
  };

  const results: RawCall[] = [];
  walk(root, (node) => {
    if (node.type !== 'call_expression') return;
    const fn = node.childForFieldName('function');
    const name = fn?.type === 'identifier' ? fn.text : fn?.type === 'member_expression' ? fn.childForFieldName('property')?.text : undefined;
    const caller = enclosing(node.startIndex);
    if (name && caller) results.push([caller, name]);
  });
  return results;
}
