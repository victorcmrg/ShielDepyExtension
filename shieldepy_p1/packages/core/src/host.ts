import { statSync } from 'node:fs';

/**
 * O pouco do "mundo lá fora" que o núcleo precisa. A extensão implementa com o OutputChannel
 * do VS Code; CLI, web e testes usam `nodeHost`. É isso que mantém o core livre de `vscode`.
 */
export interface Host {
  log(message: string): void;
  /** true se o caminho existe e é arquivo — o resolvedor de import consulta isso. */
  isFile(fsPath: string): boolean;
}

export function isFileOnDisk(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export const nodeHost: Host = {
  log: (message) => console.log(message),
  isFile: isFileOnDisk,
};

export const silentHost: Host = {
  log: () => {},
  isFile: isFileOnDisk,
};
