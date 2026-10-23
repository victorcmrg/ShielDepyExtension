import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeGraph, silentHost, toFileId } from '../src/index';
import { defaultWasmDir } from '../src/wasm-path';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** `CodeGraph` real, com as gramáticas `.wasm` de verdade — nada de parser falso. */
export function createGraph(): Promise<CodeGraph> {
  return CodeGraph.create(defaultWasmDir(), silentHost);
}

/** Diretório temporário com arquivos de fixture escritos em disco (o resolver de import consulta o disco). */
export class Fixture {
  readonly dir: string;

  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-'));
  }

  /** Escreve o arquivo e devolve o caminho em disco. */
  write(relPath: string, content: string): string {
    const full = this.path(relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return full;
  }

  path(relPath: string): string {
    return path.join(this.dir, relPath);
  }

  cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Escreve o arquivo no disco, atualiza o grafo e devolve o id do arquivo no grafo. */
export function indexFile(graph: CodeGraph, fx: Fixture, relPath: string, content: string): string {
  const fsPath = fx.write(relPath, content);
  graph.updateFile(fsPath, content);
  return toFileId(fsPath);
}

/** Id do nó de símbolo pelo nome, dentro de um arquivo. */
export function symbolId(graph: CodeGraph, name: string, fileId: string): string {
  const id = graph.ownedSymbols(fileId).find((s) => {
    const attrs = graph.nodeAttributes(s);
    return attrs?.kind !== 'file' && attrs?.name === name;
  });
  if (!id) throw new Error(`símbolo "${name}" não encontrado em ${fileId}`);
  return id;
}
