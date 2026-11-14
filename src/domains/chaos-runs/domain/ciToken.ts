// Token com que o CI publica execuções num projeto. O valor só existe na criação: guardamos o hash.

export const CI_TOKEN_PREFIX = 'sdci_';

export interface CiToken {
  id: number;
  label: string;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Tem a forma de um token de CI (antes de procurar no banco). */
export const looksLikeCiToken = (raw: string): boolean => raw.startsWith(CI_TOKEN_PREFIX);
