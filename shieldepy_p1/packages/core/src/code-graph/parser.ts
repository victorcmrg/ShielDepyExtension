import * as path from 'node:path';
import Parser from 'web-tree-sitter';

export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

// `Parser.init` inicializa o runtime WASM do módulo inteiro — uma vez por processo basta.
let runtimeInit: Promise<void> | undefined;
const languageCache = new Map<string, Promise<Parser.Language>>();

function withTimeout<T>(promise: Promise<T>, label: string, ms = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timeout (${ms}ms) carregando ${label} — verifique se o arquivo existe em wasm/ e não está corrompido.`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadLanguage(file: string): Promise<Parser.Language> {
  let cached = languageCache.get(file);
  if (!cached) {
    cached = withTimeout(Parser.Language.load(file), path.basename(file));
    languageCache.set(file, cached);
  }
  return cached;
}

/**
 * Parser Tree-sitter de TS/TSX compartilhado pelo grafo estrutural e pelo extrator de regras —
 * um arquivo é parseado UMA vez e a mesma árvore alimenta os dois.
 * Quem chama `parse` é dono da árvore e precisa chamar `tree.delete()` (memória WASM não é
 * coletada pelo GC — era o vazamento do item 2.1).
 */
export class TsParser {
  private constructor(
    private readonly parser: Parser,
    private readonly ts: Parser.Language,
    private readonly tsx: Parser.Language
  ) {}

  static async load(wasmDir: string): Promise<TsParser> {
    // O loader WASM do web-tree-sitter, quando um .wasm não existe/está corrompido, às vezes
    // fica pendurado em vez de rejeitar — o timeout garante que ninguém trave esperando.
    runtimeInit ??= withTimeout(
      Parser.init({ locateFile: (fileName: string) => path.join(wasmDir, fileName) }),
      'tree-sitter.wasm (runtime)'
    );
    try {
      await runtimeInit;
    } catch (err) {
      runtimeInit = undefined;
      throw err;
    }
    const [ts, tsx] = await Promise.all([
      loadLanguage(path.join(wasmDir, 'tree-sitter-typescript.wasm')),
      loadLanguage(path.join(wasmDir, 'tree-sitter-tsx.wasm')),
    ]);
    return new TsParser(new Parser(), ts, tsx);
  }

  /** `.tsx`/`.jsx` usam a gramática TSX; o resto, a de TypeScript (que também lê JS puro). */
  static isJsxPath(fsPath: string): boolean {
    return /\.(tsx|jsx)$/i.test(fsPath);
  }

  parse(text: string, jsx: boolean): Tree {
    this.parser.setLanguage(jsx ? this.tsx : this.ts);
    return this.parser.parse(text);
  }

  /** Parseia, entrega a raiz e libera a árvore — pra quem não precisa guardar nada dela. */
  withTree<T>(text: string, jsx: boolean, fn: (root: SyntaxNode) => T): T {
    const tree = this.parse(text, jsx);
    try {
      return fn(tree.rootNode);
    } finally {
      tree.delete();
    }
  }
}
