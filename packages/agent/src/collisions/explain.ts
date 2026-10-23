// O maestro do diagnóstico. Sempre entrega um DiagnosisReport — nunca quebra: sem IA, ou se a
// IA falhar/responder fora do formato, cai no explicador offline.

import type { Collision, Rule } from '@shieldepy/core';
import { isAbortError, type LLMProvider, type Logger } from '../provider';
import { stripFences } from '../text';
import { explainOffline } from './offline';
import { buildFactsMessage, buildSystemPrompt, parseResponse } from './prompt';
import type { DiagnosisReport } from './types';

export async function explainCollisions(
  collisions: Collision[],
  rules: Rule[],
  provider: LLMProvider | undefined,
  options: { log?: Logger; signal?: AbortSignal; attempts?: number } = {}
): Promise<DiagnosisReport> {
  if (collisions.length === 0 || !provider) return explainOffline(collisions, rules);

  const system = buildSystemPrompt();
  const content = buildFactsMessage(collisions, rules);
  const attempts = options.attempts ?? 2;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const text = await provider.complete({
        system,
        messages: [{ role: 'user', content }],
        tier: 'deep',
        maxTokens: 8000,
        json: true,
        signal: options.signal,
      });
      return parseResponse(stripFences(text), collisions, provider.name);
    } catch (err) {
      if (isAbortError(err)) throw err;
      options.log?.(`[explain] ${provider.name} falhou (tentativa ${attempt}/${attempts}): ${err instanceof Error ? err.message : err}`);
    }
  }

  options.log?.('[explain] usando explicador offline (fallback).');
  return explainOffline(collisions, rules);
}
