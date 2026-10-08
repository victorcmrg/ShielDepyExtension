// Tipos da topologia (E2): rotas HTTP, operações de I/O e o que torna uma rota sensível.
// Ids de arquivo/símbolo são os do CodeGraph (absolutos); `buildTopology` os deixa relativos na saída.
// Linhas são 0-based, como no CodeGraph e no SystemGraph.

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

export interface RouteScan {
  routes: Route[];
  skipped: SkippedRoute[];
}
