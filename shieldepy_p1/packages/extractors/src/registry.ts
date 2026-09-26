import { extOf, TsParser } from '@shieldepy/core';
import { parseCSharp } from './regex/dotnet-mediatr';
import { parseJava } from './regex/java-spring';
import { parseNodeHandlers } from './regex/node-events';
import { parsePython } from './regex/python-django';
import { parseTsHandlers } from './treesitter/event-handlers';
import type { ParsedRule } from './types';

export type Language = 'ts' | 'java' | 'python' | 'csharp';

export interface Extractor {
  language: Language;
  extensions: string[];
  engine: 'treesitter' | 'regex';
  /** `fsPath` é opcional — só decide TS × TSX. */
  parse(source: string, fsPath?: string): ParsedRule[];
}

export interface Registry {
  readonly extractors: readonly Extractor[];
  forPath(fsPath: string): Extractor | undefined;
  forLanguage(language: Language): Extractor;
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Registro ÚNICO linguagem/extensão → extrator. Antes existiam três (CLI, relatório e upload
 * da web) que precisavam ser mantidos em sincronia à mão.
 * Com `tsParser`, TS/JS usa o extrator Tree-sitter; sem ele, cai no regex (fallback).
 */
export function createRegistry(options: { tsParser?: TsParser } = {}): Registry {
  const { tsParser } = options;
  const ts: Extractor = tsParser
    ? {
        language: 'ts',
        extensions: TS_EXTENSIONS,
        engine: 'treesitter',
        parse: (source, fsPath) => parseTsHandlers(tsParser, source, fsPath ? TsParser.isJsxPath(fsPath) : false),
      }
    : { language: 'ts', extensions: TS_EXTENSIONS, engine: 'regex', parse: parseNodeHandlers };

  const extractors: Extractor[] = [
    ts,
    { language: 'java', extensions: ['.java'], engine: 'regex', parse: parseJava },
    { language: 'python', extensions: ['.py'], engine: 'regex', parse: parsePython },
    { language: 'csharp', extensions: ['.cs'], engine: 'regex', parse: parseCSharp },
  ];

  return {
    extractors,
    forPath: (fsPath) => {
      const ext = extOf(fsPath);
      return extractors.find((e) => e.extensions.includes(ext));
    },
    forLanguage: (language) => extractors.find((e) => e.language === language)!,
  };
}
