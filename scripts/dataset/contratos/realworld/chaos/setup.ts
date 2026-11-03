// Gerado pelo `shieldepy chaos --init`: carregado antes de cada teste de caos. O banco de chaos/db.ts sobe antes do app, e a URL do Prisma aponta para ele; o `express` guarda o app criado e o `listen()` dele não abre porta.
// Nada no código do app muda. Pode editar (o --init não sobrescreve).
import './db';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

// require() (CommonJS): o vi.mock não alcança o require nativo; a troca é no módulo em cache, antes de o app carregar
const nodeRequire = createRequire(import.meta.url);

// --- o app Express: o projeto o cria ao ser importado (o contrato importa o arquivo); o teste o pega com chaosApp()
type App = { listen: (...args: unknown[]) => unknown };
// no globalThis: o contrato pode carregar outra instância deste arquivo, e os apps são um só registro
const registry = ((globalThis as { __shieldepyApps?: { created: App[]; listened?: App } }).__shieldepyApps ??= { created: [] });

/** Um servidor que não ouve nada: o suficiente para quem chama `server.close()` ou `server.on()`. */
function fakeServer() {
  const server = Object.assign(new EventEmitter(), {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }),
    close: (callback?: () => void) => {
      if (callback) setImmediate(callback);
      return server;
    },
  });
  return server;
}

function wrapExpress(real: any): any {
  if (real.__shieldepy) return real;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const app = real.apply(this, args) as App;
    registry.created.push(app);
    app.listen = (...listenArgs: unknown[]) => {
      registry.listened = app;
      const callback = listenArgs.find((a) => typeof a === 'function') as (() => void) | undefined;
      if (callback) setImmediate(callback);
      return fakeServer();
    };
    return app;
  };
  // express.Router, express.json, express.static...
  return Object.assign(wrapped, real, { __shieldepy: true });
}

/** O app que o projeto criou: o que chamou listen(), senão o último criado (os sub-apps nascem antes, nos imports). */
export function chaosApp(): App {
  const app = registry.listened ?? registry.created.at(-1);
  if (!app) throw new Error('chaos/setup.ts: nenhum app Express foi criado ao importar src/main.ts. Confira o createApp do shieldepy.chaos.config.ts');
  return app;
}

// import (ESM e TypeScript): o Vitest troca o módulo
vi.mock('express', async (importOriginal) => {
  const real = await importOriginal<any>();
  const wrapped = wrapExpress(real.default ?? real);
  return { ...real, default: wrapped };
});

const expressId = nodeRequire.resolve('express');
nodeRequire(expressId);
nodeRequire.cache[expressId]!.exports = wrapExpress(nodeRequire.cache[expressId]!.exports);
