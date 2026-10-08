import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GrammarParser, parseCss, parseHtml, resolveWebRef } from '../src/index';
import { defaultWasmDir } from '../src/wasm-path';

let css: GrammarParser;
let html: GrammarParser;

beforeAll(async () => {
  [css, html] = await Promise.all([GrammarParser.load(defaultWasmDir(), 'css'), GrammarParser.load(defaultWasmDir(), 'html')]);
});

describe('HTML/CSS pela AST (sem regex)', () => {
  it('CSS: seletores de regras (inclusive em @media e :is), sem pseudo-classe, cor ou comentário', () => {
    const src = [
      '/* .comentado {} */',
      '@import url("base.css");',
      '@import "theme.css";',
      '.a, #b > .c:hover, div.d { color: #fff; }',
      '@media (max-width: 1px) { .e { x: y } }',
      ':is(.f, .g) {}',
    ].join('\n');
    const { selectors, imports } = css.withTree(src, parseCss);
    expect(selectors.sort()).toEqual(['#b', '.a', '.c', '.d', '.e', '.f', '.g']);
    expect(imports).toEqual(['base.css', 'theme.css']);
  });

  it('HTML: class/id (com e sem aspas, maiúsculas), linha certa, comentário ignorado, link/script', () => {
    const src = [
      '<html><head><link rel="stylesheet" href="style.css"/><script src="app.js"></script></head>',
      '<body><!-- <div class="comentado"> -->',
      '<div class="ok  dois" id="main"><p CLASS=x>t</p></div>',
      '<link href="https://cdn.x/y.css">',
      '</body></html>',
    ].join('\n');
    const { usages, refs } = html.withTree(src, parseHtml);
    expect(usages).toEqual([
      { token: '.ok', line: 2 },
      { token: '.dois', line: 2 },
      { token: '#main', line: 2 },
      { token: '.x', line: 2 },
    ]);
    expect(refs).toEqual(['style.css', 'app.js', 'https://cdn.x/y.css']);
  });

  it('resolveWebRef: externo e data: ficam de fora; query e âncora saem do caminho', () => {
    const from = path.resolve('/site/index.html');
    expect(resolveWebRef(from, 'https://cdn.x/y.css')).toBeUndefined();
    expect(resolveWebRef(from, '//cdn.x/y.css')).toBeUndefined();
    expect(resolveWebRef(from, 'data:text/css,x')).toBeUndefined();
    expect(resolveWebRef(from, 'css/a.css?v=2#x')).toBe(path.resolve('/site/css/a.css'));
  });
});
