// Sugestão inline (ghost text) a partir da vizinhança real do símbolo sob o cursor.

import type { EnclosingSymbol, GraphSnapshot, SymbolContextEntry } from '@shieldepy/core';
import type { LLMProvider } from '../provider';
import { INLINE_SYSTEM_PROMPT } from './prompts';

export interface InlineRequest {
  prefix: string;
  suffix: string;
  languageId: string;
  subgraph: GraphSnapshot;
  enclosing?: EnclosingSymbol;
  localContext?: SymbolContextEntry[];
  signal?: AbortSignal;
}

/**
 * Ghost text. O contexto vem da vizinhança REAL do símbolo que envolve o cursor — é o que
 * garante que uma chamada sugerida bata com o nome e a assinatura de verdade.
 */
export async function inlineSuggestion(provider: LLMProvider, req: InlineRequest): Promise<string> {
  const lines: string[] = [`Linguagem: ${req.languageId}`];
  if (req.enclosing) lines.push(`Cursor dentro de: ${req.enclosing.kind} ${req.enclosing.name}${req.enclosing.signature ?? ''}`);

  const local = (req.localContext ?? []).slice(0, 20);
  if (local.length > 0) {
    lines.push(
      'Conectado diretamente (chama / é chamado por), use só esses nomes e assinaturas se for sugerir uma chamada:',
      ...local.map((s) => `- ${s.kind} ${s.name}${s.signature ?? '()'} (${s.file})`)
    );
  } else {
    const names = req.subgraph.nodes.flatMap((n) => (n.attributes.kind !== 'file' ? [n.attributes.name] : [])).slice(0, 40);
    if (names.length > 0) lines.push(`Símbolos vizinhos no grafo: ${JSON.stringify(names)}`);
  }
  lines.push('', 'Código antes do cursor:', '```', req.prefix.slice(-1500), '```', 'Código depois do cursor:', '```', req.suffix.slice(0, 300), '```');

  const text = await provider.complete({
    system: INLINE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: lines.join('\n') }],
    tier: 'fast',
    maxTokens: 200,
    signal: req.signal,
  });
  return text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '');
}
