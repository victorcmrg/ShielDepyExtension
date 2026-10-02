import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { toFileId, type RelatedLocation } from '@shieldepy/core';

/** Trecho de código em volta de um ponto — o que o balão mostra (a outra ponta da colisão ou o próprio achado). */
export interface ConflictSnippet {
  file: string;
  fileName: string;
  folder: string;
  line: number;
  language: string;
  lines: Array<{ number: number; text: string; hit: boolean }>;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.java': 'java', '.py': 'python', '.cs': 'csharp', '.html': 'html', '.htm': 'html', '.css': 'css',
};

const MAX_LINE_CHARS = 160;
const LINE_BREAK = /\r?\n/;

/**
 * Lê `context` linhas em volta do ponto citado. Usa o documento aberto (com edições não salvas)
 * quando existe; senão o disco. Arquivo sumido → undefined, e o balão só não mostra o código.
 * `texts` reaproveita o arquivo já lido quando vários trechos saem do mesmo lugar numa passada.
 */
export function readSnippet(location: RelatedLocation, context = 2, texts?: Map<string, string[]>): ConflictSnippet | undefined {
  const fileId = toFileId(location.file);
  let all = texts?.get(fileId);
  if (!all) {
    try {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && toFileId(d.uri.fsPath) === fileId);
      all = (open ? open.getText() : readFileSync(location.file, 'utf8')).split(LINE_BREAK);
    } catch {
      return undefined;
    }
    texts?.set(fileId, all);
  }
  const target = Math.min(Math.max(location.line, 0), Math.max(all.length - 1, 0));
  const from = Math.max(target - context, 0);
  const to = Math.min(target + context, all.length - 1);
  const relative = vscode.workspace.asRelativePath(vscode.Uri.file(location.file));
  const lines = [];
  for (let i = from; i <= to; i++) {
    const raw = all[i] ?? '';
    lines.push({ number: i + 1, text: raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…` : raw, hit: i === target });
  }
  return {
    file: location.file,
    fileName: path.basename(relative),
    folder: path.dirname(relative) === '.' ? '' : path.dirname(relative).replace(/\\/g, '/'),
    line: target,
    language: LANGUAGE_BY_EXT[path.extname(location.file).toLowerCase()] ?? '',
    lines,
  };
}

/** Mesmo trecho como bloco de código markdown (hover do editor), com a linha do conflito marcada. */
export function snippetMarkdown(snippet: ConflictSnippet): string {
  const width = String(snippet.lines[snippet.lines.length - 1]?.number ?? 0).length;
  const body = snippet.lines.map((l) => `${l.hit ? '›' : ' '} ${String(l.number).padStart(width)}  ${l.text}`).join('\n');
  // Cerca maior que qualquer sequência de crases do próprio código, pra o trecho não fechar o bloco.
  const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${fence}${snippet.language}\n${body}\n${fence}`;
}
