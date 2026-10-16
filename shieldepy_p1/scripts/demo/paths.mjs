// Onde a demo mora: FORA do repositório, para não sujar o projeto. Por padrão em
// ~/ShielDepy-demo (no Windows, C:\Users\<você>\ShielDepy-demo); DEMO_DIR muda o lugar.
//   ShielDepy-demo/
//     sistema-loja/      o sistema de exemplo que abre no VS Code (um repositório git)
//     portal-data/       o banco do portal local
//     seed.json          tokens da extensão e do CI, criados a cada execução
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** shieldepy_p1/ */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEMO = resolve(process.env.DEMO_DIR || join(homedir(), 'ShielDepy-demo'));
export const WORKSPACE = join(DEMO, 'sistema-loja');
export const APP = join(WORKSPACE, 'checkout');
export const PORTAL_DATA = join(DEMO, 'portal-data');
export const SEED_FILE = join(DEMO, 'seed.json');
