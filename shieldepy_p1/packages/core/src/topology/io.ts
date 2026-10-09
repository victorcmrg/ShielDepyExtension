// Operações de I/O, uma por chamada resolvida: banco (`pg`, Prisma) e API externa (`fetch`
// global, `axios`). A detecção é pelo pacote para o qual a chamada resolveu no grafo, não pelo
// nome da variável — `db.query()` só é banco se `db` vier de `pg`.

import type { CallArg, CallSite } from '../code-graph/types';
import { classifySql } from '../sql/classify';
import type { IoOperation, TimeoutState } from './types';

const PRISMA_READ = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const PRISMA_WRITE = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const PRISMA_RAW_SQL = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);

/** Onde fica o objeto de configuração em cada método do axios (`axios.post(url, data, config)`). */
const AXIOS_CONFIG_INDEX: Record<string, number> = {
  get: 1,
  delete: 1,
  head: 1,
  options: 1,
  post: 2,
  put: 2,
  patch: 2,
  postForm: 2,
  putForm: 2,
  patchForm: 2,
  request: 0,
};

/** Texto estático de uma URL/SQL: string inteira, ou o começo literal de um template. */
function staticText(arg: CallArg | undefined): { text: string; complete: boolean } | undefined {
  if (arg?.kind === 'string') return { text: arg.value, complete: true };
  if (arg?.kind === 'template') return { text: arg.prefix, complete: false };
  return undefined;
}

/** Host de uma URL absoluta (`https://api.stripe.com/v1/...` → `api.stripe.com`), ou `dynamic`. */
export function hostOf(arg: CallArg | undefined): string {
  const url = staticText(arg)?.text;
  if (!url) return 'dynamic';
  try {
    const host = new URL(url).hostname;
    return host === '' ? 'dynamic' : host.toLowerCase();
  } catch {
    return 'dynamic';
  }
}

/** Timeout pela config: `signal`/`timeout` presente → yes; objeto sem eles ou config ausente → no; variável → unknown. */
function timeoutIn(config: CallArg | undefined, keys: string[], absent: TimeoutState): TimeoutState {
  if (!config) return absent;
  if (config.kind !== 'object') return 'unknown';
  if (config.keys.some((k) => keys.includes(k))) return 'yes';
  return config.keys.includes('...') ? 'unknown' : absent;
}

function pgOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  if (site.name !== 'query') return undefined;
  // `query('SELECT ...', [..])` ou o formato objeto `query({ text: 'SELECT ...', values: [..] })`
  const first = site.args[0];
  const sql = staticText(first?.kind === 'object' ? first.texts?.text : first);
  if (!sql) return { kind: 'db_unknown', target: 'dynamic', via: 'pg' };
  const s = classifySql(sql.text);
  if (s.kind === 'tx') return { kind: 'db_tx', target: 'transaction', via: 'pg', operation: s.verb };
  if (s.kind === 'unknown') return { kind: 'db_unknown', target: s.table ?? 'dynamic', via: 'pg' };
  return {
    kind: s.kind === 'read' ? 'db_read' : 'db_write',
    target: s.table ?? 'dynamic',
    via: 'pg',
    ...(s.verb && { operation: s.verb }),
    ...(s.lock && { lock: true as const }),
  };
}

function prismaOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  if (site.name === '$transaction') return { kind: 'db_tx', target: 'transaction', via: 'prisma', operation: '$transaction' };
  if (PRISMA_RAW_SQL.has(site.name)) {
    const sql = staticText(site.args[0]);
    const s = sql ? classifySql(sql.text) : undefined;
    if (!s || s.kind === 'unknown') return { kind: 'db_unknown', target: s?.table ?? 'dynamic', via: 'prisma', operation: site.name };
    if (s.kind === 'tx') return { kind: 'db_tx', target: 'transaction', via: 'prisma', operation: s.verb };
    return { kind: s.kind === 'read' ? 'db_read' : 'db_write', target: s.table ?? 'dynamic', via: 'prisma', operation: s.verb, ...(s.lock && { lock: true as const }) };
  }
  const read = PRISMA_READ.has(site.name);
  if (!read && !PRISMA_WRITE.has(site.name)) return undefined;
  // `prisma.order.create()` / `this.prisma.order.create()` — o model é o último segmento do receptor
  const model = site.object && site.object.length >= 2 ? site.object.at(-1)! : 'dynamic';
  return { kind: read ? 'db_read' : 'db_write', target: model, via: 'prisma', operation: site.name };
}

/** Pacotes que exportam um `fetch` com a mesma assinatura do global. */
const FETCH_PACKAGES = new Set(['node-fetch', 'undici', 'cross-fetch']);

function fetchOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  if (site.object || site.shadowed) return undefined;
  // `fetch` global (sem import nem variável local de mesmo nome), ou o de um pacote compatível
  const global = site.name === 'fetch' && site.outcome === 'unbound';
  const imported = site.outcome === 'external' && FETCH_PACKAGES.has(site.package!);
  if (!global && !imported) return undefined;
  return { kind: 'api_call', target: hostOf(site.args[0]), via: 'fetch', timeout: timeoutIn(site.args[1], ['signal'], 'no') };
}

function axiosOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  const direct = !site.object; // `axios(url, config)` / `axios(config)`
  const index = direct ? (site.args[0]?.kind === 'object' ? 0 : 1) : AXIOS_CONFIG_INDEX[site.name];
  if (index === undefined) return undefined;
  const config = site.args[index];
  const url = index === 0 ? undefined : site.args[0];
  // instância (`const api = axios.create({ timeout })`): sem timeout na chamada, pode estar na instância
  const absent: TimeoutState = site.receiverOrigin ? 'unknown' : 'no';
  return {
    kind: 'api_call',
    target: hostOf(url),
    via: 'axios',
    operation: direct ? 'request' : site.name,
    timeout: timeoutIn(config, ['timeout', 'signal'], absent),
  };
}

/** A operação de I/O que esta chamada faz, ou `undefined` se ela não é I/O reconhecido. */
export function ioOperationOf(site: CallSite, file: string): IoOperation | undefined {
  let op: Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined;
  if (site.outcome === 'external' && site.package === 'pg') op = pgOperation(site);
  else if (site.outcome === 'external' && site.package === '@prisma/client') op = prismaOperation(site);
  else if (site.outcome === 'external' && site.package === 'axios') op = axiosOperation(site);
  else op = fetchOperation(site);
  return op && { ...op, symbol: site.caller, file, line: site.line };
}
