// Operações de I/O, uma por chamada resolvida: banco (`pg`, Prisma, Mongoose, TypeORM) e API externa (`fetch`
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

const MONGOOSE_READ = new Set(['find', 'findOne', 'findById', 'countDocuments', 'estimatedDocumentCount', 'count', 'exists', 'distinct', 'aggregate']);
const MONGOOSE_WRITE = new Set([
  'create',
  'insertMany',
  'save',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'findByIdAndDelete',
  'findOneAndRemove',
  'findByIdAndRemove',
  'deleteOne',
  'deleteMany',
  'remove',
  'bulkWrite',
]);
/** `session.startTransaction()` … `commitTransaction()`; o `withTransaction(cb)` só fica anotado (as operações do callback vêm antes dele na ordem). */
const MONGOOSE_TX = new Set(['startTransaction', 'commitTransaction', 'abortTransaction', 'withTransaction']);

function mongooseOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  if (MONGOOSE_TX.has(site.name)) return { kind: 'db_tx', target: 'transaction', via: 'mongoose', operation: site.name };
  const read = MONGOOSE_READ.has(site.name);
  if (!read && !MONGOOSE_WRITE.has(site.name)) return undefined;
  // o modelo vem do grafo (`mongoose.model('User', s)`), inclusive para o documento (`user.save()`)
  return { kind: read ? 'db_read' : 'db_write', target: site.model ?? 'dynamic', via: 'mongoose', operation: site.name };
}

const TYPEORM_READ = new Set([
  'find',
  'findBy',
  'findOne',
  'findOneBy',
  'findOneOrFail',
  'findOneByOrFail',
  'findAndCount',
  'findAndCountBy',
  'findByIds',
  'count',
  'countBy',
  'exist',
  'exists',
  'existsBy',
  'sum',
  'average',
  'minimum',
  'maximum',
]);
const TYPEORM_WRITE = new Set(['save', 'insert', 'update', 'upsert', 'delete', 'remove', 'softDelete', 'softRemove', 'restore', 'increment', 'decrement', 'clear']);
/** `dataSource.transaction(cb)` / `manager.transaction(cb)` só ficam anotados; o `queryRunner` explícito conta. */
const TYPEORM_TX: Record<string, string> = {
  startTransaction: 'startTransaction',
  commitTransaction: 'commitTransaction',
  rollbackTransaction: 'abortTransaction',
  transaction: 'transaction',
};

function typeormOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  const tx = TYPEORM_TX[site.name];
  if (tx && Object.hasOwn(TYPEORM_TX, site.name)) return { kind: 'db_tx', target: 'transaction', via: 'typeorm', operation: tx };
  if (site.name === 'query') {
    // SQL cru: `manager.query('UPDATE ...')`
    const sql = staticText(site.args[0]);
    const s = sql ? classifySql(sql.text) : undefined;
    if (!s || s.kind === 'unknown') return { kind: 'db_unknown', target: s?.table ?? 'dynamic', via: 'typeorm', operation: 'query' };
    if (s.kind === 'tx') return { kind: 'db_tx', target: 'transaction', via: 'typeorm', operation: s.verb };
    return { kind: s.kind === 'read' ? 'db_read' : 'db_write', target: s.table ?? 'dynamic', via: 'typeorm', operation: s.verb, ...(s.lock && { lock: true as const }) };
  }
  const read = TYPEORM_READ.has(site.name);
  if (!read && !TYPEORM_WRITE.has(site.name)) return undefined;
  // a entidade vem do grafo: `Repository<User>`, `extends Repository<Pet>` ou `getRepository(Pet)`
  return { kind: read ? 'db_read' : 'db_write', target: site.model ?? 'dynamic', via: 'typeorm', operation: site.name };
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

// --- C# (etapa L4) ------------------------------------------------------------------------------

/** EF Core: as consultas só vão ao banco quando materializam (`Where`/`Include`/`OrderBy` montam, não leem). */
const EF_READ = new Set(
  [
    'ToList', 'ToArray', 'ToDictionary', 'ToHashSet', 'First', 'FirstOrDefault', 'Single', 'SingleOrDefault', 'Last', 'LastOrDefault',
    'ElementAt', 'ElementAtOrDefault', 'Any', 'All', 'Count', 'LongCount', 'Sum', 'Min', 'Max', 'Average', 'Contains', 'Find', 'ForEach', 'Load',
  ].flatMap((m) => [m, `${m}Async`])
);
/** `Add`/`Update`/`Remove` marcam a escrita da entidade; o `SaveChanges` é quando ela vai ao banco (vira `db_tx`). */
const EF_WRITE = new Set(['Add', 'AddAsync', 'AddRange', 'AddRangeAsync', 'Update', 'UpdateRange', 'Remove', 'RemoveRange', 'Attach', 'ExecuteUpdate', 'ExecuteUpdateAsync', 'ExecuteDelete', 'ExecuteDeleteAsync']);
const EF_RAW_READ = new Set(['FromSqlRaw', 'FromSqlInterpolated', 'FromSql', 'SqlQuery', 'SqlQueryRaw']);
const EF_RAW_EXEC = new Set(['ExecuteSqlRaw', 'ExecuteSqlRawAsync', 'ExecuteSqlInterpolated', 'ExecuteSqlInterpolatedAsync', 'ExecuteSql', 'ExecuteSqlAsync']);
/** Transação explícita, no `Database` do contexto ou na conexão ADO.NET, com os nomes que o `sensitivityTags` entende. */
const DOTNET_TX: Record<string, string> = {
  BeginTransaction: 'startTransaction',
  BeginTransactionAsync: 'startTransaction',
  Commit: 'commitTransaction',
  CommitAsync: 'commitTransaction',
  Rollback: 'abortTransaction',
  RollbackAsync: 'abortTransaction',
};

/** SQL literal de um argumento, classificado. */
function sqlOperation(arg: CallArg | undefined, via: IoOperation['via'], operation: string): Omit<IoOperation, 'symbol' | 'file' | 'line'> {
  const sql = staticText(arg);
  const s = sql ? classifySql(sql.text) : undefined;
  if (!s || s.kind === 'unknown') return { kind: 'db_unknown', target: s?.table ?? 'dynamic', via, operation };
  if (s.kind === 'tx') return { kind: 'db_tx', target: 'transaction', via, operation: s.verb };
  return { kind: s.kind === 'read' ? 'db_read' : 'db_write', target: s.table ?? 'dynamic', via, operation: s.verb, ...(s.lock && { lock: true as const }) };
}

function efCoreOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  const tx = Object.hasOwn(DOTNET_TX, site.name) ? DOTNET_TX[site.name] : undefined;
  if (tx) return { kind: 'db_tx', target: 'transaction', via: 'efcore', operation: tx };
  if (site.name === 'SaveChanges' || site.name === 'SaveChangesAsync') return { kind: 'db_tx', target: 'transaction', via: 'efcore', operation: 'SaveChanges' };
  if (EF_RAW_READ.has(site.name) || EF_RAW_EXEC.has(site.name)) return sqlOperation(site.args[0], 'efcore', site.name);
  const read = EF_READ.has(site.name);
  if (!read && !EF_WRITE.has(site.name)) return undefined;
  // `FromSqlRaw("SELECT ...").ToListAsync()`: a leitura é a do SQL, já contada nele
  for (let rc = site.receiverCall; read && rc; rc = rc.receiverCall) if (EF_RAW_READ.has(rc.name)) return undefined;
  // a entidade vem do grafo: o `DbSet<T>` do contexto, inclusive no começo de uma consulta encadeada
  return { kind: read ? 'db_read' : 'db_write', target: site.model ?? 'dynamic', via: 'efcore', operation: site.name };
}

/**
 * Ardalis.Specification (`RepositoryBase<T>`, sobre o EF Core): cada método do repositório genérico já vai ao banco
 * (o `AddAsync`/`UpdateAsync`/`DeleteAsync` dele chamam o `SaveChangesAsync`). A entidade é a do `IRepository<T>` injetado.
 */
const ARDALIS_READ = new Set(['GetByIdAsync', 'GetBySpecAsync', 'FirstOrDefaultAsync', 'FirstAsync', 'SingleOrDefaultAsync', 'SingleAsync', 'ListAsync', 'CountAsync', 'AnyAsync', 'AsAsyncEnumerable']);
const ARDALIS_WRITE = new Set(['AddAsync', 'AddRangeAsync', 'UpdateAsync', 'UpdateRangeAsync', 'DeleteAsync', 'DeleteRangeAsync']);

function ardalisOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  if (site.name === 'SaveChangesAsync') return { kind: 'db_tx', target: 'transaction', via: 'efcore', operation: 'SaveChanges' };
  const read = ARDALIS_READ.has(site.name);
  if (!read && !ARDALIS_WRITE.has(site.name)) return undefined;
  return { kind: read ? 'db_read' : 'db_write', target: site.model ?? 'dynamic', via: 'efcore', operation: site.name };
}

/** Pacotes das conexões ADO.NET (onde o Dapper pendura os métodos de extensão). */
const ADO_PACKAGES = new Set(['System.Data', 'Microsoft.Data.SqlClient', 'Npgsql', 'MySqlConnector', 'Microsoft.Data.Sqlite']);
const DAPPER_METHODS = new Set(
  ['Query', 'QueryFirst', 'QueryFirstOrDefault', 'QuerySingle', 'QuerySingleOrDefault', 'QueryMultiple', 'Execute', 'ExecuteScalar', 'ExecuteReader'].flatMap((m) => [m, `${m}Async`])
);

function dapperOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  const tx = Object.hasOwn(DOTNET_TX, site.name) ? DOTNET_TX[site.name] : undefined;
  if (tx) return { kind: 'db_tx', target: 'transaction', via: 'dapper', operation: tx };
  return DAPPER_METHODS.has(site.name) ? sqlOperation(site.args[0], 'dapper', site.name) : undefined;
}

/** `HttpClient`: os métodos que fazem a requisição (`ReadFromJsonAsync` no conteúdo da resposta não é). */
const HTTPCLIENT_METHODS = new Set([
  'GetAsync', 'PostAsync', 'PutAsync', 'PatchAsync', 'DeleteAsync', 'SendAsync', 'GetStringAsync', 'GetByteArrayAsync', 'GetStreamAsync',
  'GetFromJsonAsync', 'PostAsJsonAsync', 'PutAsJsonAsync', 'PatchAsJsonAsync', 'DeleteFromJsonAsync',
]);

function httpClientOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  if (!HTTPCLIENT_METHODS.has(site.name)) return undefined;
  // `SendAsync(request)`: a URL está no `HttpRequestMessage`. O timeout é do cliente (`HttpClient.Timeout`, 100 s
  // por padrão), configurado fora da chamada (na injeção, no `AddHttpClient`): não dá para ler daqui.
  const url = site.name === 'SendAsync' ? undefined : site.args[0];
  return { kind: 'api_call', target: hostOf(url), via: 'httpclient', operation: site.name, timeout: 'unknown' };
}

// --- Java (etapa J3) -----------------------------------------------------------------------------

/** Spring Data: a operação vem do nome do método (os métodos derivados — `findByStatus`, `deleteByEmail` — inclusive). */
const SPRING_DATA_WRITE = ['save', 'delete', 'remove', 'insert', 'update'];
const SPRING_DATA_READ = ['find', 'get', 'read', 'query', 'search', 'stream', 'count', 'exists'];
/** `deleteById` começa pela palavra `delete`; `deleted` não. */
function startsWord(name: string, prefix: string): boolean {
  if (name === prefix) return true;
  const next = name[prefix.length];
  return name.startsWith(prefix) && next !== undefined && next !== next.toLowerCase();
}

function springDataOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  // só a chamada no próprio repositório: `repo.findAll().stream()` é uma leitura, não duas
  if (site.receiverCall) return undefined;
  const target = site.model ?? 'dynamic';
  if (site.name === 'flush') return { kind: 'db_tx', target: 'transaction', via: 'springdata', operation: 'flush' };
  if (SPRING_DATA_WRITE.some((p) => startsWord(site.name, p))) return { kind: 'db_write', target, via: 'springdata', operation: site.name };
  if (SPRING_DATA_READ.some((p) => startsWord(site.name, p))) return { kind: 'db_read', target, via: 'springdata', operation: site.name };
  // método de repositório com outro nome (um `@Query` próprio): fala com o banco, mas não se sabe o quê
  return { kind: 'db_unknown', target, via: 'springdata', operation: site.name };
}

/** O argumento de texto da chamada `name` mais próxima na cadeia que produziu o receptor (`.sql("...")`, `.uri("...")`). */
function chainText(site: CallSite, name: string): CallArg | undefined {
  for (let rc = site.receiverCall; rc; rc = rc.receiverCall) if (rc.name === name) return rc.args[0];
  return undefined;
}

const JDBC_METHODS = new Set(['query', 'queryForObject', 'queryForList', 'queryForMap', 'queryForRowSet', 'queryForStream', 'update', 'batchUpdate', 'execute']);
/** `JdbcClient`: `jdbcClient.sql("SELECT ...").param(..).query(..).list()` — a ida ao banco é o terminal. */
const JDBC_CLIENT_TERMINALS = new Set(['list', 'single', 'optional', 'set', 'stream', 'update', 'listOfRows', 'singleRow', 'singleValue']);

function jdbcOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  const fromClient = site.receiverCall ? chainText(site, 'sql') : undefined;
  if (fromClient && JDBC_CLIENT_TERMINALS.has(site.name)) return sqlOperation(fromClient, 'jdbctemplate', site.name);
  // `jdbcClient.sql(...).query(...)` sem terminal ainda não foi ao banco; no `JdbcTemplate`, o SQL é o 1º argumento
  if (site.receiverCall || !JDBC_METHODS.has(site.name)) return undefined;
  return sqlOperation(site.args[0], 'jdbctemplate', site.name);
}

const JPA_WRITE = new Set(['persist', 'merge', 'remove']);
const JPA_TX: Record<string, string> = { begin: 'startTransaction', commit: 'commitTransaction', rollback: 'abortTransaction' };

function jpaOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  const tx = Object.hasOwn(JPA_TX, site.name) ? JPA_TX[site.name] : undefined;
  if (tx && site.receiverCall?.name === 'getTransaction') return { kind: 'db_tx', target: 'transaction', via: 'jpa', operation: tx };
  if (site.receiverCall) return undefined; // `em.createQuery(...).getResultList()`: a operação é a do `createQuery`
  if (site.name === 'createNativeQuery' || site.name === 'createQuery') return sqlOperation(site.args[0], 'jpa', site.name);
  // `em.find(Order.class, id)`: a entidade é a classe do 1º argumento
  const entity = site.args[0]?.kind === 'constant' && site.args[0].chain.at(-1) === 'class' ? site.args[0].chain.at(-2)! : 'dynamic';
  if (site.name === 'find' || site.name === 'getReference') return { kind: 'db_read', target: entity, via: 'jpa', operation: site.name };
  if (JPA_WRITE.has(site.name)) return { kind: 'db_write', target: 'dynamic', via: 'jpa', operation: site.name };
  return undefined;
}

const REST_TEMPLATE_METHODS = new Set(['getForObject', 'getForEntity', 'postForObject', 'postForEntity', 'postForLocation', 'put', 'delete', 'patchForObject', 'exchange', 'execute', 'headForHeaders', 'optionsForAllow']);
/** `WebClient`/`RestClient`: a requisição sai no `retrieve()`/`exchange*()`; a URL está no `.uri("...")` da cadeia. */
const FLUENT_TERMINALS = new Set(['retrieve', 'exchange', 'exchangeToMono', 'exchangeToFlux']);

function springHttpOperation(site: CallSite): Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined {
  // os clientes do Spring têm o timeout no builder (configuração fora da chamada): não dá para ler daqui
  if (FLUENT_TERMINALS.has(site.name)) {
    return { kind: 'api_call', target: hostOf(chainText(site, 'uri')), via: site.package === 'spring-webclient' ? 'webclient' : 'resttemplate', operation: site.name, timeout: 'unknown' };
  }
  if (site.package !== 'spring-web-client' || site.receiverCall || !REST_TEMPLATE_METHODS.has(site.name)) return undefined;
  return { kind: 'api_call', target: hostOf(site.args[0]), via: 'resttemplate', operation: site.name, timeout: 'unknown' };
}

/** A operação de I/O que esta chamada faz, ou `undefined` se ela não é I/O reconhecido. */
export function ioOperationOf(site: CallSite, file: string): IoOperation | undefined {
  let op: Omit<IoOperation, 'symbol' | 'file' | 'line'> | undefined;
  if (site.outcome === 'external' && site.package === 'pg') op = pgOperation(site);
  else if (site.outcome === 'external' && site.package === '@prisma/client') op = prismaOperation(site);
  else if (site.outcome === 'external' && site.package === 'axios') op = axiosOperation(site);
  else if (site.outcome === 'external' && site.package === 'mongoose') op = mongooseOperation(site);
  else if (site.outcome === 'external' && site.package === 'typeorm') op = typeormOperation(site);
  else if (site.outcome === 'external' && site.package === 'Microsoft.EntityFrameworkCore') op = efCoreOperation(site);
  else if (site.outcome === 'external' && site.package === 'Ardalis.Specification.EntityFrameworkCore') op = ardalisOperation(site);
  else if (site.outcome === 'external' && site.package === 'System.Net.Http') op = httpClientOperation(site);
  else if (site.outcome === 'external' && ADO_PACKAGES.has(site.package!)) op = dapperOperation(site);
  else if (site.outcome === 'external' && site.package === 'spring-data') op = springDataOperation(site);
  else if (site.outcome === 'external' && site.package === 'spring-jdbc') op = jdbcOperation(site);
  else if (site.outcome === 'external' && site.package === 'jpa') op = jpaOperation(site);
  else if (site.outcome === 'external' && (site.package === 'spring-web-client' || site.package === 'spring-webclient')) op = springHttpOperation(site);
  else if (site.outcome === 'external' && site.package === 'java.net.http' && (site.name === 'send' || site.name === 'sendAsync')) {
    op = { kind: 'api_call', target: 'dynamic', via: 'httpclient', operation: site.name, timeout: 'unknown' };
  } else if (site.outcome === 'external' && site.package === 'spring-tx' && site.decorates && site.name === 'Transactional') {
    // `@Transactional` no método: tudo o que ele faz roda numa transação (aberta na entrada)
    op = { kind: 'db_tx', target: 'transaction', via: 'jpa', operation: 'startTransaction' };
  }
  else op = fetchOperation(site);
  return op && { ...op, symbol: site.caller, file, line: site.line };
}
