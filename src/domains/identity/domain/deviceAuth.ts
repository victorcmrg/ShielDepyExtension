// A cerimônia de "confiar" a extensão VS Code no navegador (device flow, estilo `gh auth login`):
// a extensão gera um `state`, o navegador confirma logado e emite um código de troca de uso único
// e vida curta, que a extensão troca por um token real.

export const CEREMONY_TTL_MS = 5 * 60 * 1000; // 5 minutos para completar a cerimônia inteira
export const EXCHANGE_CODE_TTL_MS = 90 * 1000; // 90 segundos para trocar o código pelo token

export type CeremonyStatus = 'pending' | 'confirmed' | 'exchanged' | 'expired';

export interface Ceremony {
  status: CeremonyStatus;
  expiresAt: number;
}

/** Pendente e vencida passa a contar como expirada (e deve ser gravada assim). */
export function currentStatus(c: Ceremony, now: number): CeremonyStatus {
  return c.status === 'pending' && c.expiresAt < now ? 'expired' : c.status;
}

/** Só uma cerimônia pendente e no prazo pode ser confirmada no navegador. */
export const canConfirm = (c: Ceremony, now: number): boolean => c.status === 'pending' && c.expiresAt >= now;

/** O código só vira token uma vez, depois de confirmado e dentro do prazo do código. */
export function canExchange(c: { status: CeremonyStatus; userId: number | null; codeExpiresAt: number | null }, now: number): boolean {
  return c.status === 'confirmed' && Boolean(c.userId) && c.codeExpiresAt !== null && c.codeExpiresAt >= now;
}
