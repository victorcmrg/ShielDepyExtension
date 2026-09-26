import type { ChatMessage } from './provider';

export const LANGUAGE_NAMES: Record<string, string> = {
  'pt-BR': 'português do Brasil',
  'en-US': 'English (US)',
  es: 'español',
  ru: 'русский (russo)',
};

/** Nome do idioma pra colocar no prompt (código desconhecido → português). */
export function languageName(code: string | undefined): string {
  return LANGUAGE_NAMES[code ?? ''] ?? LANGUAGE_NAMES['pt-BR']!;
}

/** Remove cercas de markdown (```json ... ```) caso a IA as inclua. */
export function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

export function withLineNumbers(text: string, startLine = 0): string {
  return text
    .split('\n')
    .map((line, i) => `${startLine + i}: ${line}`)
    .join('\n');
}

/**
 * Corta o histórico do chat (item 3.6): no máximo `maxTurns` mensagens e `maxChars` caracteres,
 * sempre mantendo as mais recentes e começando por uma mensagem do usuário (exigência das APIs).
 */
export function trimHistory(history: ChatMessage[], maxTurns = 20, maxChars = 60_000): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0 && kept.length < maxTurns; i--) {
    const turn = history[i]!;
    if (kept.length > 0 && chars + turn.content.length > maxChars) break;
    kept.unshift(turn);
    chars += turn.content.length;
  }
  while (kept.length > 0 && kept[0]!.role !== 'user') kept.shift();
  return kept;
}
