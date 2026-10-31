// Gerado pelo `shieldepy chaos --init`: o app do projeto sem abrir porta. Pode editar (o --init não sobrescreve).
// O chaos/setup.ts troca o `express` do app por este: cada express() guarda o app que criou, e o
// listen() não abre porta (nem chama o callback dele). Nada no código do app muda.
import { createRequire } from 'node:module';

type App = ((...args: any[]) => unknown) & { listen: (...args: any[]) => unknown };
type State = { express: (...args: any[]) => App; apps: App[]; listening?: App };

// no global: o Vitest e o require nativo podem carregar este arquivo mais de uma vez, e o express
// original tem de ser o primeiro (depois, o require dele já devolve o trocado)
const global = globalThis as typeof globalThis & { __shieldepyApp?: State };
const state = (global.__shieldepyApp ??= { express: createRequire(import.meta.url)('express'), apps: [] });

/** Um servidor parado: o bastante para quem guarda o retorno do listen(). */
const idle = {
  close(callback?: () => void) {
    callback?.();
    return idle;
  },
  address: () => null,
  on: () => idle,
  once: () => idle,
};

export function express(...args: any[]): App {
  const app = state.express(...args);
  state.apps.push(app);
  app.listen = () => {
    state.listening = app;
    return idle;
  };
  return app;
}
// express.json(), express.Router(), express.static()...
Object.assign(express, state.express);

/** O app que o projeto pôs para escutar (ou, sem listen, o último criado). */
export function capturedApp(): App {
  const app = state.listening ?? state.apps.at(-1);
  if (!app) throw new Error('nenhum express() rodou: confira o arquivo do app que o shieldepy.chaos.config.ts importa');
  return app;
}
