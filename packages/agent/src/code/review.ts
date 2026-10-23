// Revisão arquitetural completa (comando manual).

import type { GraphSnapshot } from '@shieldepy/core';
import type { LLMProvider } from '../provider';
import { ARCHITECT_SYSTEM_PROMPT } from './prompts';

/** Revisão arquitetural completa (comando manual) — tolera mais latência e exige os 5 testes. */
export async function reviewChange(
  provider: LLMProvider,
  req: { fileText: string; filePath: string; subgraph: GraphSnapshot; language: string; provenFacts?: string[]; signal?: AbortSignal }
): Promise<string> {
  const parts = [`ARQUIVO ALTERADO: ${req.filePath}`, '```', req.fileText, '```', '', 'SUBGRAFO DE IMPACTO:', '```json', JSON.stringify(req.subgraph, null, 2), '```'];
  if (req.provenFacts && req.provenFacts.length > 0) parts.push('', 'FATOS PROVADOS:', ...req.provenFacts.map((f) => `- ${f}`));
  return provider.complete({
    system: `${ARCHITECT_SYSTEM_PROMPT}\n\nResponda sempre em ${req.language}.`,
    messages: [{ role: 'user', content: parts.join('\n') }],
    tier: 'deep',
    maxTokens: 8000,
    signal: req.signal,
  });
}
