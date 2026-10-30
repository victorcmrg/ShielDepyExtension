// O `createApp` do contrato que o `--init` gera (C2a), sem editar o projeto. O mapa diz onde o app
// Express nasce (`RouteScan.apps`); daqui sai só texto, e quem grava os arquivos é a CLI.
//
// Dois jeitos, nesta ordem (docs/pesquisa/caos-projetos-reais.md, seção 5):
// - `import`: o arquivo exporta o app (ou a fábrica que o devolve) e não abre porta ao ser importado;
// - `capture`: o arquivo abre porta no topo, ou não exporta o app (os três projetos da C1). O
//   chaos/setup.ts troca o `express` por um que guarda o app criado e cujo `listen()` não abre porta;
//   o contrato importa o arquivo só pelo efeito e pega o app guardado.
// Em CommonJS o `vi.mock` não alcança o `require()` nativo: o setup troca também o módulo em cache, e o
// contrato carrega o arquivo com `createRequire`.

import { CHAOS_SETUP_FILE, type ChaosDbPlan } from './chaos-db';
import { relativeIds } from './system-graph';
import type { AttackSurface } from './topology/surface';
import type { ExpressApp } from './topology/types';

/** A marca de pendência do contrato (`CHAOS_CONFIG_TODO`), repetida: o chaos-config importa este arquivo. */
const TODO = 'TODO(shieldepy)';

export interface ChaosAppPlan {
  mode: 'import' | 'capture';
  /** O arquivo onde o app nasce, relativo à raiz e com `/`; `line` é a do `express()`, 1-based. */
  file: string;
  line: number;
  commonjs: boolean;
  /** Em `import`: o export que é o app, ou a fábrica (`factory`) que o devolve. */
  exported?: { name: string; factory: boolean };
  /** Em `capture`: os `listen` no topo do arquivo fora do app (`http.createServer(app).listen()`), 1-based. */
  foreignListens: number[];
  /** Os outros apps do projeto (`arquivo:linha`): o escolhido é o que tem mais rotas sensíveis. */
  others: string[];
}

/** O app que o contrato sobe: o que tem mais rotas sensíveis (depois, mais rotas; depois, o primeiro). */
export function chaosAppPlan(apps: ExpressApp[], surface: AttackSurface, root: string): ChaosAppPlan | undefined {
  if (apps.length === 0) return undefined;
  const rel = relativeIds(root);
  const sensitive = new Set(surface.routes.map((r) => r.id));
  const score = (a: ExpressApp) => a.routes.filter((id) => sensitive.has(id)).length;
  const ranked = [...apps].sort((a, b) => score(b) - score(a) || b.routes.length - a.routes.length);
  const app = ranked[0]!;
  const opensPort = app.listens.some((l) => l.topLevel && l.file === app.file);
  const mode = app.exported && !opensPort ? 'import' : 'capture';
  return {
    mode,
    file: rel(app.file),
    line: app.line + 1,
    commonjs: app.commonjs,
    ...(mode === 'import' && { exported: app.exported }),
    foreignListens: mode === 'capture' ? app.listens.filter((l) => !l.onApp && l.topLevel && l.file === app.file).map((l) => l.line + 1) : [],
    others: ranked.slice(1).map((a) => `${rel(a.file)}:${a.line + 1}`),
  };
}

/** `./src/app` (o TS resolve sem extensão) ou `./index.js` (o JS fica com a dele). */
function specifier(file: string): string {
  const bare = /\.(ts|tsx|mts|cts)$/.test(file) ? file.slice(0, file.lastIndexOf('.')) : file;
  return `./${bare}`;
}

const quoted = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** O que o contrato importa e como o `createApp` pega o app (ver `chaosConfigScaffold`). */
export function chaosAppContract(plan: ChaosAppPlan): { imports: string[]; doc: string; body: string; notes: string[] } {
  const spec = quoted(specifier(plan.file));
  const at = `${plan.file}:${plan.line}`;
  const nodeRequire = "import { createRequire } from 'node:module';";
  const others = plan.others.length ? [`  // outros apps no projeto: ${plan.others.join(', ')}. Troque o import se o certo for outro.`] : [];
  if (plan.mode === 'import') {
    const { name, factory } = plan.exported!;
    const call = factory ? 'projectApp()' : 'projectApp';
    const what = factory ? `a fábrica \`${name}\` de ${plan.file}` : `o app exportado por ${plan.file}`;
    if (plan.commonjs) {
      const value = name === 'default' ? 'project' : `project.${name}`;
      return {
        imports: [nodeRequire, '', `// o app do projeto (express() em ${at}), carregado como CommonJS`, `const project = createRequire(import.meta.url)(${spec});`, `const projectApp = ${value};`],
        doc: `Monta o app SEM abrir porta (os testes usam supertest): ${what}.`,
        body: `createApp: () => ${call},`,
        notes: others,
      };
    }
    const binding = name === 'default' ? 'projectApp' : `{ ${name} as projectApp }`;
    return {
      imports: [`// o app do projeto (express() em ${at})`, `import ${binding} from ${spec};`],
      doc: `Monta o app SEM abrir porta (os testes usam supertest): ${what}.`,
      body: `createApp: () => ${call},`,
      notes: others,
    };
  }
  const load = plan.commonjs ? [nodeRequire, `import { chaosApp } from './${CHAOS_SETUP_FILE.replace(/\.ts$/, '')}';`, '', `// ${plan.file} cria o app ao ser carregado (CommonJS); o chaos/setup.ts o guarda e anula o listen()`, `createRequire(import.meta.url)(${spec});`] : [`import { chaosApp } from './${CHAOS_SETUP_FILE.replace(/\.ts$/, '')}';`, `// ${plan.file} cria o app ao ser importado; o chaos/setup.ts o guarda e anula o listen()`, `import ${spec};`];
  const foreign = plan.foreignListens.map(
    (line) => `  // ${TODO}: ${plan.file}:${line} abre porta fora do app (ex.: http.createServer(app).listen()); importar o arquivo a abre de verdade`
  );
  return {
    imports: load,
    doc: `Monta o app SEM abrir porta: o app que ${plan.file} cria (express() na linha ${plan.line}), guardado pelo chaos/setup.ts.`,
    body: 'createApp: () => chaosApp(),',
    notes: [...foreign, ...others],
  };
}

/**
 * O `chaos/setup.ts`, carregado antes de cada teste gerado: a troca do `express` (modo `capture`) e a
 * do `pg` (banco gerado, C2d), as que houver. Sem nenhuma, não há setup.
 */
export function chaosSetupScaffold(parts: { db?: ChaosDbPlan; app?: ChaosAppPlan }): string | undefined {
  const express = parts.app?.mode === 'capture';
  if (!express && !parts.db) return undefined;
  const what = [express && 'o `express` guarda o app criado e o `listen()` dele não abre porta', parts.db && 'o `pg` vira o banco de chaos/db.ts'].filter(Boolean).join('; ');
  const lines = [
    `// Gerado pelo \`shieldepy chaos --init\`: carregado antes de cada teste de caos. ${what[0]!.toUpperCase()}${what.slice(1)}.`,
    '// Nada no código do app muda. Pode editar (o --init não sobrescreve).',
    "import { createRequire } from 'node:module';",
    ...(express ? ["import { EventEmitter } from 'node:events';"] : []),
    "import { vi } from 'vitest';",
    ...(parts.db ? ["import { Client, Pool } from './db';"] : []),
    '',
    '// require() (CommonJS): o vi.mock não alcança o require nativo; a troca é no módulo em cache, antes de o app carregar',
    'const nodeRequire = createRequire(import.meta.url);',
  ];
  if (express) {
    lines.push(
      '',
      '// --- o app Express: o projeto o cria ao ser importado (o contrato importa o arquivo); o teste o pega com chaosApp()',
      'type App = { listen: (...args: unknown[]) => unknown };',
      '// no globalThis: o contrato pode carregar outra instância deste arquivo, e os apps são um só registro',
      'const registry = ((globalThis as { __shieldepyApps?: { created: App[]; listened?: App } }).__shieldepyApps ??= { created: [] });',
      '',
      '/** Um servidor que não ouve nada: o suficiente para quem chama `server.close()` ou `server.on()`. */',
      'function fakeServer() {',
      '  const server = Object.assign(new EventEmitter(), {',
      "    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }),",
      '    close: (callback?: () => void) => {',
      '      if (callback) setImmediate(callback);',
      '      return server;',
      '    },',
      '  });',
      '  return server;',
      '}',
      '',
      'function wrapExpress(real: any): any {',
      '  if (real.__shieldepy) return real;',
      '  const wrapped = function (this: unknown, ...args: unknown[]) {',
      '    const app = real.apply(this, args) as App;',
      '    registry.created.push(app);',
      '    app.listen = (...listenArgs: unknown[]) => {',
      '      registry.listened = app;',
      "      const callback = listenArgs.find((a) => typeof a === 'function') as (() => void) | undefined;",
      '      if (callback) setImmediate(callback);',
      '      return fakeServer();',
      '    };',
      '    return app;',
      '  };',
      '  // express.Router, express.json, express.static...',
      '  return Object.assign(wrapped, real, { __shieldepy: true });',
      '}',
      '',
      '/** O app que o projeto criou: o que chamou listen(), senão o último criado (os sub-apps nascem antes, nos imports). */',
      'export function chaosApp(): App {',
      '  const app = registry.listened ?? registry.created.at(-1);',
      `  if (!app) throw new Error('chaos/setup.ts: nenhum app Express foi criado ao importar ${parts.app!.file}. Confira o createApp do shieldepy.chaos.config.ts');`,
      '  return app;',
      '}',
      '',
      '// import (ESM e TypeScript): o Vitest troca o módulo',
      "vi.mock('express', async (importOriginal) => {",
      '  const real = await importOriginal<any>();',
      '  const wrapped = wrapExpress(real.default ?? real);',
      '  return { ...real, default: wrapped };',
      '});',
      '',
      "const expressId = nodeRequire.resolve('express');",
      'nodeRequire(expressId);',
      'nodeRequire.cache[expressId]!.exports = wrapExpress(nodeRequire.cache[expressId]!.exports);'
    );
  }
  if (parts.db) {
    lines.push(
      '',
      '// --- o banco: o `pg` do app vira o PGlite de chaos/db.ts',
      "vi.mock('pg', async () => {",
      "  const db = await import('./db');",
      '  return { Pool: db.Pool, Client: db.Client, default: { Pool: db.Pool, Client: db.Client } };',
      '});',
      '',
      "const pg = nodeRequire('pg');",
      'pg.Pool = Pool;',
      'pg.Client = Client;'
    );
  }
  lines.push('');
  return lines.join('\n');
}
