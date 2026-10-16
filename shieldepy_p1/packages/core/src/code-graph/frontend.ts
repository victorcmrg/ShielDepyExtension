// Uma linguagem do mapa: como parsear um arquivo e o que extrair dele (símbolos, tabela de módulo,
// valores do topo e chamadas). O CodeGraph é um só para todas as linguagens: ele escolhe o frontend
// pela extensão, guarda o que o frontend extraiu e resolve as chamadas (etapa L do plano).

import { extractCSharp } from './extract-csharp';
import { extractModuleInfo, type ModuleInfo } from './extract-module';
import { extractCalls, extractSymbols, extractValueCalls, type CallDesc, type RawCall, type SymbolInfo } from './extract-ts';
import { topLevelHash } from './fingerprint';
import { TsParser, type GrammarParser, type SyntaxNode, type Tree } from './parser';

export type LanguageId = 'ts' | 'csharp' | 'java';

/**
 * C# e Java não importam arquivos: um nome de tipo resolve pelos namespaces (packages) que o
 * arquivo enxerga. É isto que substitui a tabela de imports na resolução dos tipos do projeto.
 */
export interface NamespaceScope {
  /**
   * Namespaces visíveis sem qualificar, em qualquer ponto do arquivo: o próprio (e os de cima, no C#),
   * os abertos por `using X;` / `import x.*;`. O namespace global (`''`) sempre vale.
   */
  visible: string[];
  /** Nome local → nome qualificado: `using Svc = App.Services.OrderService;` / `import com.x.OrderService;`. */
  aliases: Record<string, string>;
  /** `global using X;`: vale para todos os arquivos da mesma linguagem. */
  global?: string[];
}

/** Tudo o que o grafo guarda de um arquivo de código, lido de UMA árvore. */
export interface FileExtraction {
  symbols: SymbolInfo[];
  module: ModuleInfo;
  /** Valores do topo que saem de uma chamada (`const app = express()`). */
  valueCalls: Map<string, CallDesc>;
  calls: RawCall[];
  /** Hash do código de topo (fora dos símbolos): o diff entre mapas vê se ele mudou. */
  topHash: string;
  /**
   * C#/Java: os namespaces que o arquivo enxerga. Com ele, os especificadores de `module.specs` são
   * pacotes (os tipos de fora que o caos conhece, ver `extract-csharp`), nunca caminhos de arquivo.
   */
  scope?: NamespaceScope;
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

export const CSHARP_EXTENSIONS = ['.cs'] as const;

/** C# (gramática do Tree-sitter): classes, namespaces, chamadas por tipo do receptor, atributos. */
export function csharpFrontend(parser: GrammarParser): LanguageFrontend {
  return {
    language: 'csharp',
    extensions: CSHARP_EXTENSIONS,
    parse: (text) => parser.parse(text),
    extract: (root, fileId) => extractCSharp(root, fileId),
  };
}
