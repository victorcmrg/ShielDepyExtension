// Bundle separado (`dist/chaos.js`): o pipeline de caos da CLI (LangGraph, SDKs de IA, Vitest do
// projeto) só é carregado quando a pessoa roda "ShielDepy: Testar Caos". O bundle principal da
// extensão não importa este arquivo (só o tipo), então continua leve.

import { loadRegistry } from '@shieldepy/extractors';
import { runChaosCommand, type ChaosArgs } from '../../../cli/src/chaos';

export type { ChaosArgs };

export interface ChaosIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

/** O mesmo `shieldepy chaos` da CLI, com as gramáticas da extensão (`wasmDir` é obrigatório aqui). */
export function runChaos(args: ChaosArgs & { wasmDir: string }, io: ChaosIo): Promise<number> {
  return runChaosCommand(args, io, () => loadRegistry(args.wasmDir));
}
