// Uma linguagem do mapa: como parsear um arquivo e o que extrair dele (símbolos, tabela de módulo,
// valores do topo e chamadas). O CodeGraph é um só para todas as linguagens: ele escolhe o frontend
// pela extensão, guarda o que o frontend extraiu e resolve as chamadas (etapa L do plano).

import { extractModuleInfo, type ModuleInfo } from './extract-module';
import { extractCalls, extractSymbols, extractValueCalls, type CallDesc, type RawCall, type SymbolInfo } from './extract-ts';
import { topLevelHash } from './fingerprint';
import { TsParser, type SyntaxNode, type Tree } from './parser';

export type LanguageId = 'ts' | 'csharp';

/** Tudo o que o grafo guarda de um arquivo de código, lido de UMA árvore. */
export interface FileExtraction {
  symbols: SymbolInfo[];
  module: ModuleInfo;
  /** Valores do topo que saem de uma chamada (`const app = express()`). */
  valueCalls: Map<string, CallDesc>;
  calls: RawCall[];
  /** Hash do código de topo (fora dos símbolos): o diff entre mapas vê se ele mudou. */
  topHash: string;
}

export interface LanguageFrontend {
  readonly language: LanguageId;
  readonly extensions: readonly string[];
  /** Quem chama é dono da árvore e tem que chamar `tree.delete()`. */
  parse(text: string, fsPath: string): Tree;
  extract(root: SyntaxNode, fileId: string): FileExtraction;
}

export const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** TypeScript e JavaScript (a gramática TSX para `.tsx`/`.jsx`). */
export function tsFrontend(parser: TsParser): LanguageFrontend {
  return {
    language: 'ts',
    extensions: TS_EXTENSIONS,
    parse: (text, fsPath) => parser.parse(text, TsParser.isJsxPath(fsPath)),
    extract: (root, fileId) => {
      const symbols = extractSymbols(root, fileId);
      return {
        symbols,
        module: extractModuleInfo(root),
        valueCalls: extractValueCalls(root, symbols),
        calls: extractCalls(root, symbols, fileId),
        topHash: topLevelHash(root, symbols),
      };
    },
  };
}
