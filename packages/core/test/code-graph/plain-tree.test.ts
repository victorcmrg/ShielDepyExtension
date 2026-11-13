// A cópia da árvore em JavaScript (plain-tree.ts) tem que ser igual à árvore do Tree-sitter em tudo
// o que a extração lê: tipo, se é nomeado, posições, texto, filhos, filhos nomeados, campos, pai e o
// próximo irmão nomeado. Comparado nó por nó em arquivos reais do repositório (TS, TSX e JS) e num
// trecho com espaço e comentário antes do primeiro token.
//
// Duas falhas conhecidas da API de nó do web-tree-sitter 0.22 ficam de fora, porque nelas a cópia
// (que vem do cursor) é a certa: (1) alguns comentários aparecem na lista de filhos com o tipo do pai
// (um `comment` dentro de `interface_body` vem como `interface_body`); (2) `childForFieldName` às vezes
// devolve um nó lá de dentro, que não é filho, num campo que o nó nem tem.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { walk } from '../../src/code-graph/ast';
import { TsParser, type SyntaxNode } from '../../src/code-graph/parser';
import { plainTree } from '../../src/code-graph/plain-tree';
import { defaultWasmDir } from '../../src/wasm-path';
import { REPO_ROOT } from '../helpers';

// os campos das gramáticas TS/TSX que a extração consulta (e mais alguns)
const FIELDS = [
  'name', 'value', 'body', 'parameters', 'parameter', 'function', 'arguments', 'object', 'property', 'left', 'right',
  'operator', 'type', 'constructor', 'declaration', 'return_type', 'condition', 'consequence', 'alternative', 'key',
  'source', 'label', 'pattern', 'index', 'decorator', 'type_parameters', 'type_arguments', 'alias', 'initializer',
  'increment', 'handler', 'finalizer', 'argument', 'expression', 'module',
];

function same(real: SyntaxNode, copy: SyntaxNode, where: string): void {
  const at = `${where} ${real.type}@${real.startIndex}`;
  if (copy.type !== 'comment') expect(copy.type, at).toBe(real.type);
  expect(copy.isNamed, at).toBe(real.isNamed);
  expect([copy.startIndex, copy.endIndex], at).toEqual([real.startIndex, real.endIndex]);
  expect([copy.startPosition, copy.endPosition], at).toEqual([real.startPosition, real.endPosition]);
  expect(copy.text, at).toBe(real.text);
  expect(copy.childCount, at).toBe(real.childCount);
  expect(copy.namedChildren.map((c) => c.startIndex), at).toEqual(real.namedChildren.map((c) => c.startIndex));
  expect(copy.parent?.startIndex, at).toBe(real.parent?.startIndex);
  expect(copy.nextNamedSibling?.startIndex, at).toBe(real.nextNamedSibling?.startIndex);
  for (const f of FIELDS) {
    const r0 = real.childForFieldName(f);
    // (2): o que não é filho direto não é campo deste nó
    const r = r0 && r0.parent?.startIndex === real.startIndex && r0.parent?.endIndex === real.endIndex && r0.parent?.type === real.type ? r0 : null;
    const c = copy.childForFieldName(f);
    expect(c ? c.startIndex + c.type : null, `${at} .${f}`).toBe(r ? r.startIndex + r.type : null);
  }
  const rc = real.children;
  const cc = copy.children;
  for (let i = 0; i < rc.length; i++) same(rc[i]!, cc[i]!, where);
}

describe('cópia da árvore em JavaScript (para a extração não pagar o vaivém com o WASM)', async () => {
  const parser = await TsParser.load(defaultWasmDir());
  const files = [
    'packages/core/src/code-graph/extract-ts.ts',
    'packages/core/src/code-graph/CodeGraph.ts',
    'apps/web/src/portal/pages/Entrar.tsx',
    'apps/vscode/media/webview/panel.js',
  ];

  for (const rel of files) {
    it(`igual nó por nó: ${rel}`, () => {
      const file = path.join(REPO_ROOT, rel);
      const text = fs.readFileSync(file, 'utf8');
      const tree = parser.parse(text, TsParser.isJsxPath(file));
      try {
        same(tree.rootNode, plainTree(tree.rootNode), rel);
      } finally {
        tree.delete();
      }
    });
  }

  it('com espaço, comentário e acentos antes do primeiro token, e a mesma caminhada', () => {
    const text = '\n\n  // comentário com acento: ção\n/* bloco */ const x = (a: string) => a.length > 0 ? `olá ${a}` : "não";\nexport { x };\n';
    const tree = parser.parse(text, false);
    try {
      const copy = plainTree(tree.rootNode);
      same(tree.rootNode, copy, 'trecho');
      const a: string[] = [];
      const b: string[] = [];
      walk(tree.rootNode, (n) => a.push(n.type + n.startIndex));
      walk(copy, (n) => b.push(n.type + n.startIndex));
      expect(b).toEqual(a);
    } finally {
      tree.delete();
    }
  });
});
