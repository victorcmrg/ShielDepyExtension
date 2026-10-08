// Tipos da topologia (E2): rotas HTTP, operações de I/O e o que torna uma rota sensível.
// Ids de arquivo/símbolo são os do CodeGraph (absolutos); `buildTopology` os deixa relativos na saída.
// Linhas são 0-based, como no CodeGraph e no SystemGraph.

import type { Collision } from '../interactions/model';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ALL';

/** Um passo da cadeia de uma rota: middleware ou handler, na ordem em que o Express os executa. */
export interface RouteHandler {
  /** Função(ões) do projeto que tratam o passo (mais de uma quando o alvo é uma interface). */
  symbols: string[];
  /** Como está escrito no registro (`validateCheckout`, `ctrl.create`) ou `<inline>`. */
  label: string;
  /** Callback escrito no próprio registro da rota. */
  inline?: true;
  /** Middleware de pacote (`cors`, `passport.authenticate`): não se entra nele. */
  package?: string;
  /** Expressão que não dá pra seguir (`auth()`, `express.json()`): fica na cadeia, mas o percurso não entra. */
  opaque?: true;
  /** Ligado só por nome: a cadeia depende de um palpite. */
  heuristic?: true;
  /** Veio de um `use` do roteador (ou de quem o monta), não do registro da rota. */
  middleware?: true;
}

export interface Route {
  /** `POST /checkout` */
  id: string;
  method: HttpMethod;
  /** Caminho completo, com os prefixos das montagens (`app.use('/api', router)`). */
  path: string;
  /** Onde a rota é registrada. */
  file: string;
  line: number;
  handlers: RouteHandler[];
}

/** Registro que parece rota mas não pôde ser lido (path dinâmico, etc.). Entra na confiança da topologia. */
export interface SkippedRoute {
  file: string;
  line: number;
  reason: string;
}

/** `db_tx`: BEGIN/COMMIT/`$transaction`; `db_unknown`: fala com o banco, mas o SQL não é literal. */
export type IoKind = 'db_read' | 'db_write' | 'db_tx' | 'db_unknown' | 'api_call';

/** `unknown`: a config é uma variável, ou a chamada é de uma instância (`axios.create({ timeout })`). */
export type TimeoutState = 'yes' | 'no' | 'unknown';

export interface IoOperation {
  kind: IoKind;
  /** Tabela, model do Prisma, host da API, `transaction`, ou `dynamic` quando não dá pra ler. */
  target: string;
  via: 'pg' | 'prisma' | 'fetch' | 'axios';
  /** Verbo SQL, operação do Prisma ou método do axios. */
  operation?: string;
  /** `SELECT ... FOR UPDATE`. */
  lock?: true;
  /** Só `api_call`. */
  timeout?: TimeoutState;
  /** Quem faz a chamada (símbolo) e onde. */
  symbol: string;
  file: string;
  line: number;
}

export interface RouteScan {
  routes: Route[];
  skipped: SkippedRoute[];
}

/**
 * O que torna uma rota alvo de caos. Cada tag habilita falhas do catálogo da E3:
 * - `external-io`: chama API externa;
 * - `read-then-write`: lê e depois escreve o mesmo alvo (janela de corrida);
 * - `multi-write-same-target`: escreve o mesmo alvo mais de uma vez;
 * - `write-after-api-call`: grava depois de chamar uma API (falha parcial se a API cair no meio);
 * - `no-timeout`: chamada de API sem timeout;
 * - `no-transaction`: read-then-write sem transação nem `FOR UPDATE` antes da leitura.
 */
export type SensitivityTag =
  | 'external-io'
  | 'read-then-write'
  | 'multi-write-same-target'
  | 'write-after-api-call'
  | 'no-timeout'
  | 'no-transaction';

export interface RouteTag {
  tag: SensitivityTag;
  /** Tabelas/hosts envolvidos (`read-then-write` → `['stock']`). */
  targets?: string[];
}

export interface RouteOperation extends IoOperation {
  /** Posição na ordem de execução aproximada da rota (1, 2, 3...). */
  order: number;
  /** `heuristic`: o caminho até aqui passou por uma ligação só por nome. */
  confidence: 'proven' | 'heuristic';
  /** Símbolos do handler até quem faz a operação. */
  through: string[];
}

export interface TopologyRoute extends Route {
  operations: RouteOperation[];
  tags: RouteTag[];
  /** Colisões entre regras reativas cujo handler está no caminho da rota. */
  collisions: string[];
  confidence: 'proven' | 'heuristic';
  /** O percurso parou no limite de profundidade ou de passos: pode faltar operação. */
  truncated?: true;
}

export interface TopologyCollision {
  /** `collisionKey` — o mesmo id que `TopologyRoute.collisions` usa. */
  key: string;
  bucket: string;
  collision: Collision;
  /** Rotas que passam por um dos handlers da colisão. */
  routes: string[];
}

export interface TopologyGraph {
  version: 1;
  /** SHA-256 do conteúdo (sem o próprio campo): mesma entrada, mesmo hash. */
  contentHash: string;
  /** Hash do `SystemGraph` de onde a topologia saiu. */
  systemGraphHash: string;
  stats: {
    routes: number;
    sensitiveRoutes: number;
    operations: number;
    skippedRoutes: number;
    truncatedRoutes: number;
    collisions: number;
    callsHeuristic: number;
    callsUnresolved: number;
  };
  routes: TopologyRoute[];
  skipped: SkippedRoute[];
  collisions: TopologyCollision[];
}
