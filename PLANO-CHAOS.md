# Plano — Chaos Engineering dirigida por Análise Estática (fatia vertical)

## Contexto
Hoje o ShielDepy só prova **colisões entre handlers de evento** (`Rule` → buckets `resource::event`) e **ciclos de chamada** (CodeGraph via Tree-sitter). Não há detecção de rotas HTTP nem de I/O (DB/API), não há export do grafo, não há LangGraph e não há `.github/`. O objetivo é o motor determinístico apontar as rotas sensíveis (`topology-graph.json`), um pipeline LangGraph gerar testes de caos **apenas** para essas rotas, executá-los com Vitest e bloquear o PR quando o código quebra sob falha física.

Decisões tomadas: **LangGraph.js em TS** (dentro de `packages/agent`, sobre o `LLMProvider` existente), alvo **Express + fetch/axios + pg/Prisma**, runner **Vitest** (+ supertest + MSW), entrega **ponta a ponta com `Network_Chaos_Agent` e `Concurrency_Agent`**; `DB_Chaos_Agent` fica para depois.

Princípio mantido do projeto: *o motor prova, a IA propõe*. Toda saída da IA é validada; sem chave de API existe caminho offline determinístico; um teste só conta como falha se passar no **run de controle** (sem caos).

**Ordem de entrega (ajuste pedido):** primeiro aperfeiçoar o mapeamento do sistema em grafos (Fase 0 + Fase 1), com métrica de cobertura e testes. Só depois disso, e com o grafo validado nos exemplos, entram os agentes (Fases 2–4). Cada marco é um PR separado.

## Progresso e fluxo de trabalho

Este arquivo é atualizado a cada passo. Cada ponto importante gera um commit na branch do marco, e o marco termina com merge na `main`.

| Marco | Branch | Status |
|---|---|---|
| 1a. Fase 0: imports (tsconfig paths, require, barrels, default, alias, namespace) | `feat/chaos-grafo` | concluído |
| 1b. Fase 0: chamadas (this, instâncias, params tipados, references) | `feat/chaos-grafo` | em andamento |
| 1c. Fase 0: snapshot unificado + exemplo `checkout-express` com 100% de cobertura | `feat/chaos-grafo` | pendente |
| 1d. Extratores de regras sem regex: Java/Python/C# para Tree-sitter (gramáticas já no `tree-sitter-wasms`); PL/pgSQL precisa de gramática SQL à parte | a definir | pendente |
| 2. Fase 1: topologia (`topology-graph.json`, rotas, I/O, CLI `topology`) | a definir | pendente |
| 3. Fases 2–3: LangGraph + agentes | a definir | pendente |
| 4. Fase 4: execução, gate, GitHub Actions | a definir | pendente |

### Registro
- 2026-10-07: plano aprovado. Branch `feat/chaos-grafo` criada a partir de `main` (`79366d9`).
- 2026-10-07: **1a concluído.**
  - Novo `extract-module.ts`: tabela de imports, exports e re-exports por arquivo, lida da AST. Cobre alias, default (nomeado e anônimo), namespace, barrels, `require` e `module.exports`/`exports.x`.
  - `ModuleResolver`: `paths`/`baseUrl` do tsconfig (com comentários e `extends`); especificador não relativo vira pacote.
  - Nós `package` (`pkg:<nome>`), com arestas `imports` e `calls` para eles.
  - `CodeGraph.stats` agora traz cobertura: `callsResolved`, `callsHeuristic`, `callsUnresolved`, `callsExternal`, `importsUnresolved`. Também há `fileCoverage(fileId)`.
  - O fallback por nome continua, mas a aresta sai marcada `heuristic: true`.
  - O receptor de `obj.m()` é lido da AST (sem regex).
  - Suíte: 166 → 180 testes, todos passando.
- Decisão: nada de regex para ler código. O grafo e os extratores novos são 100% Tree-sitter, e os extratores de regras que ainda usam regex migram no marco 1d.
- Confirmado com o usuário: o motor marca os nós críticos; o Threat Modeler é o 1º nó do LangGraph e roteia hipóteses para especialistas por tipo de erro.

---

## Fase 0 — Aperfeiçoar o grafo de código (pré-requisito)

As limitações atuais do `CodeGraph`, documentadas no README e em [extract-ts.ts](shieldepy_p1/packages/core/src/code-graph/extract-ts.ts), fazem a BFS a partir de uma rota perder chamadas. Isso precisa ser corrigido antes:

1. **Resolução de imports** ([resolve-import.ts](shieldepy_p1/packages/core/src/code-graph/resolve-import.ts)):
   - `paths` e `baseUrl` do `tsconfig.json`
   - `require()` em CommonJS
   - re-exports e barrels (`export * from`, `export { x } from`, `index.ts`)
   - `export default`
   - import com alias (`import { a as b }`)
   - `import * as ns` com chamadas `ns.fn()`
2. **Resolução de chamadas além do nome simples:**
   - `this.method()` dentro da classe
   - `obj.method()` quando `obj` vem de `new Classe()` ou de um import de instância (ex.: `export const service = new Service()`)
   - funções passadas como argumento (handlers do Express, `router.use(mw)`) → aresta `references`
3. **Pacotes externos como nós:** imports não relativos (`pg`, `@prisma/client`, `axios`, `express`) viram nós `external` do tipo pacote. Assim o grafo sabe que `pool` vem de `pg`, e os detectores de I/O da Fase 1 deixam de depender só do nome da variável.
4. **Métrica de cobertura:** `graph.stats` passa a contar `callsResolved`, `callsUnresolved` e `importsUnresolved`. O comando `shieldepy topology --json` mostra esses números, para medirmos a qualidade do mapa em cada repositório.
5. **Grafo unificado:** um único snapshot exportável (`toSnapshot()` no `CodeGraph`), que junta arquivos, símbolos, pacotes externos, rotas, operações de I/O e os buckets `resource::event`. Hoje só existe o subgrafo de impacto (`getImpactSubgraph`).
6. **Testes:** fixtures em `core/test/code-graph/` para cada caso acima. Também uma meta de cobertura nos exemplos `examples/pedidos-microservices` e `checkout-express`: 100% das chamadas internas resolvidas.

Os itens 1–3 entram no mesmo hook `onParsed`. Não há segundo parse.

## Fase 1 — Topologia determinística (`packages/core/src/topology/`)

1. **`types.ts`** — schema versionado e estável:
   ```ts
   TopologyGraph { version: 1; root; generatedAt?; contentHash; routes: RouteNode[]; buckets: BucketNode[] }
   RouteNode { id; method; path; file; line; handlerSymbol; operations: Operation[]; sensitivity: SensitivityTag[] }
   Operation { type: 'db_read'|'db_write'|'api_call'; target; via: 'pg'|'prisma'|'fetch'|'axios'; symbol; file; line; order }
   SensitivityTag = 'external-io' | 'read-then-write' | 'multi-write-same-target' | 'write-after-api-call'
   BucketNode { key: `${resource}::${event}`; rules; collisions }   // reaproveita buildGraph/findCollisions
   ```
2. **`extract-routes.ts`** (Tree-sitter, padrão de `extract-ts.ts`): `app|router.(get|post|put|patch|delete)('<literal>', ...handlers)`; handlers inline ou identificadores resolvidos para o symbolId do CodeGraph.
3. **`extract-io.ts`** (Tree-sitter), por símbolo envolvente (`getEnclosingSymbol`):
   - `fetch('<url>')`, `axios.<verb>(...)`/`axios(...)` → `api_call`, target = host do literal (ou `dynamic`).
   - `<x>.query('<SQL>')` (pg) → SQL literal classificado: `INSERT|UPDATE|DELETE` → `db_write`, `SELECT` → `db_read` (`FOR UPDATE` anotado); target = tabela.
   - `prisma.<model>.<op>` → `create|update|upsert|delete*` = write, `find*|count|aggregate` = read.
4. **Hook de parse único**: registrar os dois extratores via `CodeGraph.onParsed` (mesmo padrão de `WorkspaceModel`), guardando `opsBySymbol` e `routesByFile`.
5. **`build.ts`** — `buildTopology(graph, rules)`: para cada rota, BFS pelas arestas `calls` a partir do handler (profundidade limitada, ex. 6) coletando operações em ordem de linha; calcula as `SensitivityTag`s; anexa buckets com colisões.
6. **`filter.ts`** — `attackSurface(topology)`: mantém só rotas com pelo menos uma operação de I/O e buckets com colisão (isolamento de contexto — helpers nunca vão para a IA).
7. **`serialize.ts`** — saída canônica (chaves e arrays ordenados, caminhos relativos ao root) + `contentHash` SHA-256 → artefato reprodutível.
8. Exportar tudo em `packages/core/src/index.ts`.

**CLI**: novo comando `shieldepy topology <pasta> [--out .shieldepy/topology-graph.json] [--json]` em [main.ts](shieldepy_p1/apps/cli/src/main.ts), reaproveitando o caminho headless do `cycles` (`CodeGraph.create` + `indexFiles`) e `loadRulesFromPath`.

**VS Code** (pequeno): comando “ShielDepy: Exportar topologia” usando o `WorkspaceModel` (que já mantém graph + regras) para gravar `.shieldepy/topology-graph.json`. O `BackgroundAnalyzer` não muda de responsabilidade.

## Fase 2 — LangGraph + Threat Modeler (`packages/agent/src/chaos/`)

1. Dependências: `@langchain/langgraph` + `@langchain/core` em `packages/agent`. Nós chamam o `LLMProvider` existente ([provider.ts](shieldepy_p1/packages/agent/src/provider.ts)) — sem chat models do LangChain.
2. **`state.ts`** — `Annotation.Root`: `parsedGraph: TopologyGraph`, `identifiedRisks: Hypothesis[]`, `generatedTests: GeneratedTest[]`, `testResults: TestResult[]`, `errors: string[]`.
3. **`catalog.ts`** — catálogo fixo de erros de produção: `timeout`, `http_5xx_intermittent`, `malformed_response`, `race_condition`, `retry_storm`, `partial_failure_after_external_call`, cada um com a `SensitivityTag` que o habilita.
4. **`nodes/threat-modeler.ts`** — tier `deep`, `json: true`; system prompt rígido com o catálogo; entrada = `attackSurface` serializado. Saída `Hypothesis { id; routeId; failure: CatalogId; rationale; agent: 'network'|'concurrency'; params }`, validada por `validate-hypotheses.ts` (padrão de `core/src/interactions/validate.ts`): rota tem que existir, `failure` tem que estar no catálogo e ser compatível com as tags da rota — o resto é descartado.
5. **Offline** (`offline.ts`): sem provider, hipóteses derivadas direto das tags (todo `api_call` → timeout + 503; `read-then-write`/`multi-write` → race).

## Fase 3 — Agentes de caos (geração de testes)

Para evitar código livre não confiável, os agentes **preenchem specs estruturadas** que templates determinísticos transformam em `.spec.ts`:

- **`nodes/network-chaos.ts`** → `NetworkSpec { routeId; host; mode: 'delay'|'status'|'malformed'; delayMs?; status?; request: {body,headers}; expect: Invariant[] }` → `templates/network.ts` gera MSW `setupServer` + `http.all('https://<host>/*', ...)` + supertest no app.
- **`nodes/concurrency.ts`** → `ConcurrencySpec { routeId; parallel: number (≤100); request; expect: Invariant[] }` → `templates/concurrency.ts` gera `Promise.all` de N requisições supertest.
- **`Invariant`** = DSL pequena e verificável: `statusIn`, `maxSuccesses`, `respondsWithin`, `noUnhandledRejection`, e `stateCheck { name }` que chama uma função declarada pelo usuário no config (ver abaixo). O LLM escolhe parâmetros e invariantes; nunca escreve o corpo do teste.
- Roteamento por aresta condicional do LangGraph: hipóteses `network` → nó network, `concurrency` → nó concurrency (fan-out via `Send`), depois `render` → `write` → `run` → `report`.
- Contrato do projeto-alvo: `shieldepy.chaos.config.ts` exportando `{ createApp(): Express; reset(): Promise<void>; invariants?: Record<string, () => Promise<boolean>> }` (ex.: `stockNeverNegative`). Sem config → CLI aborta com instrução clara.
- Saída: `.shieldepy/chaos-tests/<rota>__<falha>.spec.ts` + `vitest.config.ts` gerado (timeout, `include` só dessa pasta). Pasta adicionada ao `.gitignore` do alvo pela documentação.

I/O (escrever arquivos, rodar processo) é injetado nos nós via interface `ChaosIo { write(files); run(dir): Promise<TestResult[]> }` → `packages/agent` continua testável sem efeitos colaterais.

## Fase 4 — Execução, prova e gate

1. **`apps/cli/src/chaos/run.ts`**: `spawn('npx', ['vitest','run','--config', '.shieldepy/chaos-tests/vitest.config.ts','--reporter=json'])` no diretório do alvo; parse do JSON → `TestResult { specId; hypothesisId; status; failureMessage; durationMs }`.
2. **Run de controle (anti falso-positivo)**: cada spec é gerada com um bloco `control` (mesma requisição, sem caos, 1 chamada). Se o controle falhar, o resultado vira `invalid` (ambiente/teste ruim) e **não** bloqueia.
3. **Comando CLI** `shieldepy chaos <pasta> [--fail-on] [--offline] [--out .shieldepy] [--report chaos-report.md]`: topology → LangGraph → resultados. Exit 1 se houver falha válida (respeitando `--fail-on`, mapeando falhas para `Severity`: race/perda de dados = Crítico, timeout sem tratamento = Alto…). Exit 2 em erro de ambiente.
4. **Relatório** (`nodes/report.ts`): markdown determinístico (rota, falha injetada, invariante violada, arquivo:linha das operações) + parágrafo opcional da IA explicando (com fallback offline), no estilo de `explainCollisions`.
5. **GitHub Actions**: `.github/workflows/shieldepy-chaos.yml` (raiz do repo) — checkout, Node 22, `npm ci`, `shieldepy chaos <alvo> --report chaos-report.md --fail-on Alto`, publica em `$GITHUB_STEP_SUMMARY` e comenta no PR com `gh pr comment --edit-last || gh pr comment` (`permissions: pull-requests: write`); `ANTHROPIC_API_KEY` via secret, roda `--offline` quando ausente. Também um template documentado em `docs/` para repositórios-alvo.

## Exemplo de validação
`shieldepy_p1/examples/checkout-express/`: `POST /checkout` que faz `SELECT stock` (pg, via `pg-mem` em memória) → `fetch('https://api.stripe.com/v1/charges')` → `UPDATE stock`/`INSERT orders` **sem lock** (race proposital) e sem timeout no fetch. Inclui `shieldepy.chaos.config.ts` com invariante `stockNeverNegative`. Variante `checkout-express-fixed` (com `SELECT ... FOR UPDATE`/transação + `AbortSignal.timeout`) deve passar.

## Arquivos críticos
- Novo: `packages/core/src/topology/*`, `packages/agent/src/chaos/*`, `apps/cli/src/chaos/run.ts`, `.github/workflows/shieldepy-chaos.yml`, `examples/checkout-express*`.
- Alterar: [main.ts](shieldepy_p1/apps/cli/src/main.ts) (comandos `topology`/`chaos`, USAGE), `packages/core/src/index.ts`, `packages/agent/src/index.ts`, `packages/agent/package.json`, [WorkspaceModel.ts](shieldepy_p1/apps/vscode/src/workspace/WorkspaceModel.ts) (registrar extratores no `onParsed`) + comando de export na extensão, `shieldepy_p1/README.md` (seção nova + limites).
- Reusar: `CodeGraph.onParsed`, `getEnclosingSymbol`, `indexFiles`/`listSourceFiles`, `buildGraph`/`findCollisions`, `parseRules` (padrão de validação), `providerFromEnv`, `severityRank`, `gate()` da CLI.

## Verificação
0. **Gate do marco 1 (grafo):**
   - `shieldepy topology examples/checkout-express --json` mostra `callsUnresolved = 0`.
   - A rota mostra a cadeia completa handler → service → repo → `pg` e `fetch`.
   - Os testes das fixtures da Fase 0 passam.
   - Só depois disso começa a Fase 2.
1. `npm test` — testes Vitest novos:
   - `core/test/topology/*`: extratores de rota/I/O sobre fixtures inline (fetch, axios, pg SQL, prisma), BFS por chamadas, tags, filtro, hash estável (duas execuções = mesmo JSON).
   - `agent/test/chaos/*`: validação de hipóteses (descarta rota inexistente/falha fora do catálogo), templates geram código que compila (`tsc --noEmit` em snapshot), grafo LangGraph com `LLMProvider` fake e `ChaosIo` fake percorre todos os estados.
   - `cli/test`: `topology` em `examples/checkout-express` gera `POST /checkout` com `db_read→api_call→db_write` e tags `read-then-write`, `write-after-api-call`.
2. `npm run typecheck`.
3. E2E manual: `npm run cli -- chaos examples/checkout-express --offline` → exit 1, relatório aponta race (estoque negativo) e timeout no Stripe; mesmo comando em `checkout-express-fixed` → exit 0. Repetir com `ANTHROPIC_API_KEY`.
4. Abrir PR de teste no GitHub com o exemplo vulnerável e confirmar check vermelho + comentário no PR.
