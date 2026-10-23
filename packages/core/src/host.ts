import { readFileSync, statSync } from 'node:fs';

/**
 * O pouco do "mundo lá fora" que o núcleo precisa. A extensão implementa com o OutputChannel
 * do VS Code; CLI, web e testes usam `nodeHost`. É isso que mantém o core livre de `vscode`.
 */
export interface Host {
  log(message: string): void;
  /** true se o caminho existe e é arquivo — o resolvedor de import consulta isso. */
  isFile(fsPath: string): boolean;
  /** Conteúdo de um arquivo de configuração (tsconfig/jsconfig). Opcional: sem ele, `paths` não é resolvido. */
  readFile?(fsPath: string): string | undefined;
}

export function isFileOnDisk(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function readFileOnDisk(fsPath: string): string | undefined {
  try {
    return readFileSync(fsPath, 'utf8');
  } catch {
    return undefined;
  }
}

export const nodeHost: Host = {
  log: (message) => console.log(message),
  isFile: isFileOnDisk,
  readFile: readFileOnDisk,
};

export const silentHost: Host = {
  log: () => {},
  isFile: isFileOnDisk,
  readFile: readFileOnDisk,
};
