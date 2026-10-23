// Chat sobre o código e o protocolo FIXED_FILE (a IA propõe o arquivo inteiro corrigido).

import type { GraphSnapshot } from '@shieldepy/core';
import type { ChatMessage, LLMProvider } from '../provider';
import { trimHistory, withLineNumbers } from '../text';
import { buildCodeChatSystemPrompt } from './prompts';

export interface CodeChatContext {
  history: ChatMessage[];
  activeFile?: { path: string; text: string };
  subgraph?: GraphSnapshot;
  findings?: Array<{ id: string; line: number; severity: string; message: string; impact?: string; source: string }>;
  language: string;
  signal?: AbortSignal;
}

/** Chat livre sobre o código: Q&A, pedidos de correção (protocolo FIXED_FILE), resumo de varredura. */
export async function codeChat(provider: LLMProvider, ctx: CodeChatContext): Promise<string> {
  const contextParts: string[] = [];
  if (ctx.activeFile) contextParts.push(`ARQUIVO ATIVO: ${ctx.activeFile.path}`, '```', withLineNumbers(ctx.activeFile.text), '```');
  if (ctx.findings && ctx.findings.length > 0) {
    contextParts.push('PROBLEMAS JÁ DETECTADOS NESTE ARQUIVO (cite pelo #id ao responder):', JSON.stringify(ctx.findings));
  }
  if (ctx.subgraph) contextParts.push('SUBGRAFO DE IMPACTO (dependências/chamadas vizinhas):', JSON.stringify(ctx.subgraph));

  const history = trimHistory(ctx.history);
  const messages: ChatMessage[] = [];
  if (contextParts.length > 0) {
    messages.push({ role: 'user', content: contextParts.join('\n') });
    messages.push({ role: 'assistant', content: 'Entendido, tenho o contexto do arquivo atual.' });
  }
  messages.push(...history);

  return provider.complete({
    system: buildCodeChatSystemPrompt(ctx.language),
    messages,
    tier: 'deep',
    maxTokens: 16000,
    signal: ctx.signal,
  });
}

/**
 * Extrai uma proposta `FIXED_FILE: <caminho>` + bloco de código da resposta do chat. Parser ÚNICO
 * (item 5.3): a extensão manda pro webview a resposta já separada, o webview não reparseia.
 * `explanation` junta o texto antes E depois do bloco (ex.: um aviso de regressão no fim).
 */
export function parseFixedFile(reply: string): { path: string; content: string; explanation: string } | undefined {
  const match = /FIXED_FILE:\s*(.+?)\s*\n```[^\n]*\n([\s\S]*?)(?:\n```|$)/.exec(reply);
  if (!match) return undefined;
  const before = reply.slice(0, match.index).trim();
  const after = reply.slice(match.index + match[0].length).trim();
  return { path: match[1]!.trim(), content: match[2]!, explanation: [before, after].filter(Boolean).join('\n\n') };
}

/** Versão pro histórico: sem o arquivo inteiro (reenviar isso a cada mensagem cresce sem limite). */
export function stripFixedFile(reply: string): string {
  const fix = parseFixedFile(reply);
  if (!fix) return reply;
  return `${fix.explanation} [correção de ${fix.path} proposta anteriormente — conteúdo omitido do histórico]`.trim();
}
