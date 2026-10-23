import { extOf, GrammarParser, TsParser } from '@shieldepy/core';
import { parseCSharp } from './treesitter/dotnet-mediatr';
import { parseTsHandlers } from './treesitter/event-handlers';
import { parseJava } from './treesitter/java-spring';
import { parsePython } from './treesitter/python-django';
import type { ParsedRule } from './types';

export type Language = 'ts' | 'java' | 'python' | 'csharp';

export interface Extractor {
  language: Language;
  extensions: string[];
  /** `fsPath` é opcional — só decide TS × TSX. */
  parse(source: string, fsPath?: string): ParsedRule[];
}

export interface Registry {
  readonly extractors: readonly Extractor[];
  forPath(fsPath: string): Extractor | undefined;
  forLanguage(language: Language): Extractor | undefined;
}

/** Parsers Tree-sitter disponíveis. Linguagem sem parser simplesmente não é extraída. */
export interface RegistryParsers {
  tsParser?: TsParser;
  java?: GrammarParser;
  python?: GrammarParser;
  csharp?: GrammarParser;
}

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Registro ÚNICO linguagem/extensão → extrator. Antes existiam três (CLI, relatório e upload
 * da web) que precisavam ser mantidos em sincronia à mão.
 * Tudo é lido pela AST do Tree-sitter — sem regex. Uma gramática que não carregou deixa a
 * linguagem de fora (o arquivo aparece como ignorado), em vez de cair numa leitura aproximada.
 */
export function createRegistry(parsers: RegistryParsers = {}): Registry {
  const { tsParser, java, python, csharp } = parsers;
  const extractors: Extractor[] = [];
  if (tsParser) {
    extractors.push({
      language: 'ts',
      extensions: TS_EXTENSIONS,
      parse: (source, fsPath) => parseTsHandlers(tsParser, source, fsPath ? TsParser.isJsxPath(fsPath) : false),
    });
  }
  if (java) extractors.push({ language: 'java', extensions: ['.java'], parse: (source) => parseJava(java, source) });
  if (python) extractors.push({ language: 'python', extensions: ['.py'], parse: (source) => parsePython(python, source) });
  if (csharp) extractors.push({ language: 'csharp', extensions: ['.cs'], parse: (source) => parseCSharp(csharp, source) });

  return {
    extractors,
    forPath: (fsPath) => {
      const ext = extOf(fsPath);
      return extractors.find((e) => e.extensions.includes(ext));
    },
    forLanguage: (language) => extractors.find((e) => e.language === language),
  };
}

/**
 * Carrega todas as gramáticas de `wasmDir` e monta o registro. Cada gramática que falhar só
 * tira a sua linguagem (e é reportada em `failed`) — nunca derruba as outras.
 */
export async function loadRegistry(wasmDir: string, options: { tsParser?: TsParser } = {}): Promise<Registry & { failed: Language[] }> {
  const failed: Language[] = [];
  const attempt = async <T>(language: Language, load: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await load();
    } catch {
      failed.push(language);
      return undefined;
    }
  };
  const [tsParser, java, python, csharp] = await Promise.all([
    options.tsParser ?? attempt('ts', () => TsParser.load(wasmDir)),
    attempt('java', () => GrammarParser.load(wasmDir, 'java')),
    attempt('python', () => GrammarParser.load(wasmDir, 'python')),
    attempt('csharp', () => GrammarParser.load(wasmDir, 'c_sharp')),
  ]);
  return { ...createRegistry({ tsParser, java, python, csharp }), failed };
}
