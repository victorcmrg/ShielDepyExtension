import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isChaosSource, isProjectManifest, listSourceFiles, projectTree } from '../../src';

let root: string;
const write = (rel: string, content = '') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const posix = (list: string[]) => list.map((p) => p.split(path.sep).join('/'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-tree-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('projectTree', () => {
  it('não entra em subpasta que é outro projeto, e lista só a de cima quando elas se aninham', () => {
    write('package.json', '{ "name": "raiz" }');
    write('src/app.ts');
    write('examples/loja/package.json', '{ "name": "loja" }');
    write('examples/loja/src/app.ts');
    write('examples/loja/tools/package.json', '{ "name": "tools" }');
    write('examples/aspnet/Program.cs');
    const tree = projectTree(root);
    expect(posix(tree.files)).toEqual(['examples/aspnet/Program.cs', 'package.json', 'src/app.ts']);
    expect(posix(tree.nested)).toEqual(['examples/loja']);
  });

  it('um package.json só de configuração de pasta (`"type"`) não faz da pasta um projeto', () => {
    write('package.json', '{ "name": "raiz" }');
    write('src/package.json', '{ "type": "module" }');
    write('src/app.ts');
    expect(posix(projectTree(root).files)).toContain('src/app.ts');
    expect(projectTree(root).nested).toEqual([]);
  });

  it('o limite do listSourceFiles conta só os arquivos do projeto', async () => {
    write('a/package.json', '{ "name": "a" }');
    write('a/x.ts');
    write('z.ts');
    expect(await listSourceFiles(root, 1, projectTree(root).files)).toEqual([path.join(root, 'z.ts')]);
  });
});

describe('isProjectManifest', () => {
  it.each([
    ['{ "name": "x" }', true],
    ['{ "dependencies": {} }', true],
    ['{ "devDependencies": {} }', true],
    ['{ "scripts": {} }', true],
    ['{ "workspaces": [] }', true],
    ['{ "type": "module" }', false],
    ['{}', false],
    ['não é json', false],
    ['[]', false],
  ])('%s → %s', (text, expected) => {
    expect(isProjectManifest(text)).toBe(expected);
  });
});

describe('isChaosSource', () => {
  it('JS/TS entra; C# e Java não', () => {
    expect(['a.ts', 'a.JS', 'a.mjs', 'a.cs', 'a.java'].map(isChaosSource)).toEqual([true, true, true, false, false]);
  });
});
