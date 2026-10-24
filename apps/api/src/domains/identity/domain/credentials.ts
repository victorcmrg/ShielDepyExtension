// Credenciais opacas (não JWT): a sessão web (cookie) e o token da extensão (Bearer). Opacas
// para poder revogar na hora; o banco guarda só o hash — um vazamento da tabela não expõe nada
// utilizável.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
/** 90 dias, renovado a cada uso (sliding). */
export const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DEVICE_TOKEN_PREFIX = 'sde_';
const MAX_DEVICE_LABEL = 120;
export const DEFAULT_DEVICE_LABEL = 'VS Code';

export interface DeviceInfo {
  id: number;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Vale se não foi revogada e não venceu. */
export const isUsable = (c: { expiresAt: number; revokedAt?: number | null }, now: number): boolean => !c.revokedAt && c.expiresAt >= now;

/** O nome que a extensão manda para o dispositivo, limitado; vazio vira null (a tela mostra "VS Code"). */
export const deviceLabel = (label: string | null | undefined): string | null => (label ?? '').slice(0, MAX_DEVICE_LABEL) || null;
