// O que o CI manda (`shieldepy publish`): só fatos (rotas, operações, tabelas, hosts,
// arquivo:linha), nenhum código-fonte.

/**
 * O contrato do upload, do lado da API: espelha o `ChaosResults`/`ChaosRunUpload` de
 * packages/agent/src/chaos/results.ts sem importá-lo (a API não depende do motor, decisão 0008).
 * Só os campos que a API lê têm tipo; o resto é guardado como veio e devolvido ao portal.
 */
export interface ChaosResults {
  version: 1;
  ran: boolean;
  runError?: string;
  failOn?: string;
  engine?: string;
  hits: number;
  scope?: { tested: string[] };
  outcomes: { status: 'passed' | 'failed' | 'invalid' }[];
  untested: unknown[];
  cost?: { usd?: number };
  [field: string]: unknown;
}

export interface ChaosRunUpload {
  version: 1;
  remote: string;
  commit: string;
  branch?: string;
  pr?: number;
  prUrl?: string;
  runUrl?: string;
  results: ChaosResults;
}

export class UploadError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
/** Só http(s): o link vira <a href> no portal (nada de `javascript:`). */
const httpUrl = (v: unknown): string | undefined => {
  const s = str(v, 500);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** Confere a forma do upload antes de gravar; o que for opcional e vier errado, sai. */
export function parseUpload(raw: unknown): ChaosRunUpload {
  if (!isObj(raw) || raw.version !== 1) throw new UploadError('payload inválido (esperado version: 1)');
  const remote = str(raw.remote, 300);
  const commit = str(raw.commit, 80);
  if (!remote || !commit) throw new UploadError('faltam o remote e o commit');
  const r = raw.results;
  if (!isObj(r) || r.version !== 1 || !Array.isArray(r.outcomes) || !Array.isArray(r.untested) || typeof r.hits !== 'number') {
    throw new UploadError('resultado do caos inválido (gere com o shieldepy chaos desta versão)');
  }
  const pr = typeof raw.pr === 'number' && Number.isInteger(raw.pr) && raw.pr > 0 ? raw.pr : undefined;
  const branch = str(raw.branch, 200);
  const prUrl = httpUrl(raw.prUrl);
  const runUrl = httpUrl(raw.runUrl);
  return {
    version: 1,
    remote,
    commit,
    ...(branch && { branch }),
    ...(pr && { pr }),
    ...(prUrl && { prUrl }),
    ...(runUrl && { runUrl }),
    results: r as unknown as ChaosResults,
  };
}
