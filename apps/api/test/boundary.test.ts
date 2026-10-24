// Fronteira produto × empresa (decisão 0008): apps/api e apps/web não dependem do motor (core,
// extractors, agent, viewer), nem pelo package.json nem por import. E o web só fala com a API por
// HTTP: nenhum dos dois importa arquivo do outro. Os imports saem da AST do TypeScript (decisão 0002).
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MOTOR = ['core', 'extractors', 'agent', 'viewer'];
const MOTOR_PACKAGES = MOTOR.map((name) => `@shieldepy/${name}`);
const MOTOR_DIRS = MOTOR.map((name) => path.join(ROOT, 'packages', name));
const APPS = {
  api: { dir: path.join(ROOT, 'apps', 'api'), other: path.join(ROOT, 'apps', 'web') },
  web: { dir: path.join(ROOT, 'apps', 'web'), other: path.join(ROOT, 'apps', 'api') },
};
const CODE = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-ssr', 'data']);

function codeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : codeFiles(full);
    return CODE.has(path.extname(entry.name)) ? [full] : [];
  });
}

/** Todo especificador de módulo do arquivo: import/export from, import(), require() e import type. */
function moduleSpecifiers(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg)) found.push(arg.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const inside = (file: string, dir: string) => file === dir || file.startsWith(dir + path.sep);

function violations(app: keyof typeof APPS): string[] {
  const { dir, other } = APPS[app];
  const out: string[] = [];
  for (const file of codeFiles(dir)) {
    for (const spec of moduleSpecifiers(file, readFileSync(file, 'utf8'))) {
      const where = `${path.relative(ROOT, file)}: '${spec}'`;
      if (MOTOR_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(pkg + '/'))) out.push(`${where} (motor)`);
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (MOTOR_DIRS.some((motor) => inside(target, motor))) out.push(`${where} (motor por caminho)`);
      if (inside(target, other)) out.push(`${where} (o outro app: fale por HTTP)`);
    }
  }
  return out;
}

// --- camadas da API (decisão 0013) -------------------------------------------------------------
const API_SRC = path.join(ROOT, 'apps', 'api', 'src');
const DRIVERS = ['drizzle-orm', 'pg', '@electric-sql/pglite', 'node:http', 'node:https', 'node:net', 'node:fs', 'node:fs/promises'];
/** O pacote ou um subcaminho dele (drizzle-orm/pg-core). */
const isDriver = (spec: string) => DRIVERS.some((d) => spec === d || spec.startsWith(d + '/'));

/** Onde um arquivo de apps/api/src fica: { domain, layer } em domains/<domain>/<layer>/, ou 'shared'. */
function placeOf(file: string): { domain: string; layer: string } | 'shared' | null {
  const parts = path.relative(API_SRC, file).split(path.sep);
  if (parts[0] === 'shared') return 'shared';
  if (parts[0] === 'domains' && parts.length >= 4) return { domain: parts[1]!, layer: parts[2]! };
  // domains/<domain>/index.ts: a montagem do contexto (para o app.ts, os testes e a demo)
  if (parts[0] === 'domains' && (parts.length === 2 || parts.length === 3)) return { domain: parts[1]!, layer: 'index' };
  return null;
}

/** Por que `spec`, importado de `file`, quebra as camadas (ou null se pode). */
function layerViolation(file: string, spec: string): string | null {
  const from = placeOf(file);
  if (!from) return null;
  const target = spec.startsWith('.') ? placeOf(path.resolve(path.dirname(file), spec)) : null;
  if (from === 'shared') return target && target !== 'shared' ? 'shared não importa domínio' : null;
  if (from.layer === 'domain') {
    if (isDriver(spec)) return 'domain não faz I/O';
    if (target === 'shared') return 'domain não importa shared';
    if (target && (target.domain !== from.domain || target.layer !== 'domain')) return 'domain só importa o próprio domain';
    return null;
  }
  if (target && target !== 'shared' && target.domain !== from.domain && target.layer !== 'application') {
    return 'outro domínio só pela application dele';
  }
  return null;
}

function layerViolations(): string[] {
  return codeFiles(API_SRC).flatMap((file) =>
    moduleSpecifiers(file, readFileSync(file, 'utf8')).flatMap((spec) => {
      const why = layerViolation(file, spec);
      return why ? [`${path.relative(ROOT, file)}: '${spec}' (${why})`] : [];
    })
  );
}

describe('camadas da API (S7, decisão 0013)', () => {
  it('apps/api/src respeita as camadas', () => {
    expect(layerViolations()).toEqual([]);
  });

  it('cada regra pega o que deve e deixa passar o resto', () => {
    const at = (rel: string) => path.join(API_SRC, ...rel.split('/'));
    const domain = at('domains/projects/domain/project.ts');
    const app = at('domains/projects/application/projects.ts');
    expect(layerViolation(domain, 'drizzle-orm')).toBe('domain não faz I/O');
    expect(layerViolation(domain, 'drizzle-orm/pg-core')).toBe('domain não faz I/O');
    expect(layerViolation(domain, 'pg')).toBe('domain não faz I/O');
    expect(layerViolation(domain, 'pgx')).toBeNull();
    expect(layerViolation(domain, '../../../shared/db/postgres')).toBe('domain não importa shared');
    expect(layerViolation(domain, '../infra/DrizzleProjectRepository')).toBe('domain só importa o próprio domain');
    expect(layerViolation(domain, '../../companies/domain/company')).toBe('domain só importa o próprio domain');
    expect(layerViolation(domain, './remote')).toBeNull();
    expect(layerViolation(app, '../../companies/infra/DrizzleCompanyRepository')).toBe('outro domínio só pela application dele');
    expect(layerViolation(app, '../../companies/application/companies')).toBeNull();
    expect(layerViolation(app, '../domain/project')).toBeNull();
    expect(layerViolation(app, '../../companies')).toBe('outro domínio só pela application dele');
    expect(layerViolation(at('domains/projects/http/routes.ts'), '../../companies/index')).toBe('outro domínio só pela application dele');
    expect(layerViolation(at('shared/http/http.ts'), '../../domains/projects/domain/project')).toBe('shared não importa domínio');
  });
});

describe('fronteira produto × empresa (S4)', () => {
  it.each(Object.keys(APPS) as (keyof typeof APPS)[])('apps/%s não declara o motor no package.json', (app) => {
    const pkg = JSON.parse(readFileSync(path.join(APPS[app].dir, 'package.json'), 'utf8'));
    const declared = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) => Object.keys(pkg[field] ?? {}));
    expect(declared.filter((dep) => MOTOR_PACKAGES.includes(dep))).toEqual([]);
  });

  it.each(Object.keys(APPS) as (keyof typeof APPS)[])('apps/%s não importa o motor nem o outro app', (app) => {
    expect(violations(app)).toEqual([]);
  });

  it('a leitura dos imports pega todas as formas', () => {
    const text = [
      "import { a } from '@shieldepy/core';",
      "import type { B } from '@shieldepy/agent/chaos';",
      "export * from '../../packages/viewer/src';",
      "const c = await import('@shieldepy/extractors');",
      "const d = require('node:fs');",
      "let e: import('../web/src/x').T;",
      "const s = 'from \\'@shieldepy/core\\'';", // texto, não import
    ].join('\n');
    expect(moduleSpecifiers('x.ts', text)).toEqual([
      '@shieldepy/core',
      '@shieldepy/agent/chaos',
      '../../packages/viewer/src',
      '@shieldepy/extractors',
      'node:fs',
      '../web/src/x',
    ]);
  });
});
