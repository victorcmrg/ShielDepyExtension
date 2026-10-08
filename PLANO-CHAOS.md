# Plano — Chaos Engineering dirigida por Análise Estática (fatia vertical)

## Contexto
Hoje o ShielDepy só prova **colisões entre handlers de evento** (`Rule` → buckets `resource::event`) e **ciclos de chamada** (CodeGraph via Tree-sitter). Não há detecção de rotas HTTP nem de I/O (DB/API), não há export do grafo, não há LangGraph e não há `.github/`. O objetivo é o motor determinístico apontar as rotas sensíveis (`topology-graph.json`), um pipeline LangGraph gerar testes de caos **apenas** para essas rotas, executá-los com Vitest e bloquear o PR quando o código quebra sob falha física.

Decisões tomadas: **LangGraph.js em TS** (dentro de `packages/agent`, sobre o `LLMProvider` existente), alvo **Express + fetch/axios + pg/Prisma**, runner **Vitest** (+ supertest + MSW), entrega **ponta a ponta com `Network_Chaos_Agent` e `Concurrency_Agent`**; `DB_Chaos_Agent` fica para depois.

Princípio mantido do projeto: *o motor prova, a IA propõe*. Toda saída da IA é validada; sem chave de API existe caminho offline determinístico; um teste só conta como falha se passar no **run de controle** (sem caos).

**Ordem de entrega (ajuste pedido):** primeiro aperfeiçoar o mapeamento do sistema em grafos (Fase 0 + Fase 1), com métrica de cobertura e testes. Só depois disso, e com o grafo validado nos exemplos, entram os agentes (Fases 2–4). Cada marco é um PR separado.

## Progresso e fluxo de trabalho

Este arquivo é atualizado a cada tarefa concluída, no mesmo commit da mudança. Cada etapa tem sua branch. **O merge na `main` é feito pelo usuário** quando a etapa inteira estiver completa.

- **E1 — Mapeamento em grafos** (tarefas 1a–1d, branch `feat/chaos-grafo`): pré-requisito de tudo. O grafo precisa ser completo e confiável antes de qualquer agente. **Completa em 2026-10-07, mergeada na `main` (PR #1).**
- **E2 — Topologia** (tarefas 2a–2f, ver a seção "Fase 1 / E2"), **E3 — Agentes** (tarefa 3), **E4 — Gate de CI** (tarefa 4).
- **Merges feitos:** `feat/chaos-grafo` (E1, PR #1) → `feat/grafo-visualizador` (V1, PR #2). A E2 está em andamento na branch `feat/topologia`, criada a partir da `main` (`6756ded`).

| Tarefa | Branch | Status |
|---|---|---|
| 1a. Fase 0: imports (tsconfig paths, require, barrels, default, alias, namespace) | `feat/chaos-grafo` | concluído, mergeado |
| 1b. Fase 0: chamadas (this, instâncias, params tipados, references) | `feat/chaos-grafo` | concluído, mergeado |
| 1c. Fase 0: snapshot unificado + exemplo `checkout-express` com 100% de cobertura | `feat/chaos-grafo` | concluído, mergeado |
| 1d. Extratores de regras sem regex: Java/Python/C# para Tree-sitter; PL/pgSQL por analisador léxico; HTML/CSS para Tree-sitter | `feat/chaos-grafo` | concluído, mergeado |
| V1. Visualizador de conferência do mapa (`shieldepy graph --html`) | `feat/grafo-visualizador` | concluído, mergeado |
| 2. E2 / Fase 1: topologia (`topology-graph.json`, rotas, I/O, CLI `topology`), tarefas 2a–2f | `feat/topologia` | em andamento |
| V2. Visualizador de produto (extensão/portal, com topologia e resultados do caos) | a definir | pendente, depois da E2 |
| 3. Fases 2–3: LangGraph + agentes | a definir | pendente |
| 4. Fase 4: execução, gate, GitHub Actions | a definir | pendente |
| 5. E5: grafo de chamadas para Java/C#/Python (frontend por linguagem + rotas/I/O por framework) | a definir | pendente, depois da E2 (ver avaliação) |

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
- 2026-10-07: **1b concluído.**
  - Resolução por **tipo do receptor**:
    - `this.m()` e `super.m()`
    - campos tipados, `= new X()` e `constructor(private repo: Repo)`
    - `this.x = new X()` e cadeias como `this.deps.repo.save()`
    - variável `new X()` e parâmetro tipado
    - herança entre arquivos e `implements` (a interface liga às classes que a implementam)
  - Instância exportada (`export const svc = new Svc()`) e objeto literal exportado são seguidos em outro arquivo.
  - Tipos e bases de pacote (`pool: Pool`, `extends Repository`) viram chamada externa.
  - Nova aresta `references`: handler passado como valor (`app.post('/x', auth, ctrl.create, ...)`).
  - Callback anônimo no topo do arquivo vira símbolo (`app.post('/checkout')`), então as chamadas de dentro de um handler inline não se perdem mais.
  - `references` não entra na detecção de ciclos.
  - Sem adivinhar: receptor de tipo nativo ou global (`X[]`, `Map`, `console`, `JSON`), função guardada em campo (`this.log()`) e parâmetro que esconde um import não geram aresta falsa.
  - **Medição no próprio ShielDepy:**

    | | antes | depois |
    |---|---|---|
    | `packages/` | 91,8% resolvidas com prova, 7 sem resolução | **99,1%**, **0** |
    | `apps/` | 92,4%, 50 sem resolução | **98,5%**, **0** |

    O resto é heurístico marcado: variáveis cujo tipo vem do retorno de uma função.
  - Suíte: 180 → 194 testes.
  - Melhoria futura (não bloqueia a E1): inferir o tipo pelo retorno anotado (`const sim = model.fork()`).
- 2026-10-07: **1c, parte 1: tipo de retorno.**
  - Cada função registra o retorno anotado (`Promise<T>` vira T).
  - O receptor pode ser o resultado de outra chamada: `const r = makeRepo(); r.save()`, `makeRepo().save()`, `new Repo().save()`, `(await load()).save()`.
  - Valor devolvido por pacote é externo (`Router().post`, `res.status(400).json()`), e o nativo não é adivinhado.
  - Receptor que não dá pra seguir (`a[0].b()`) só usa o fallback pelo nome do método, nunca o de função solta.
  - **Medição no ShielDepy:** `packages/` 99,9% e `apps/` 99,0% resolvidas com prova, 0 sem resolução.
  - Suíte: 196 testes.
- 2026-10-07: **1c concluído.**
  - `buildSystemGraph` (`packages/core/src/system-graph.ts`) é o mapa do sistema num artefato só. Contém o grafo de código, os baldes de regras ligados ao símbolo que implementa cada regra (o handler), as colisões, a cobertura e `weakSpots` por arquivo.
  - O JSON é canônico, com ids relativos e `contentHash` SHA-256: mesma entrada, mesmo hash.
  - CLI: `shieldepy graph <pasta> [--json] [--out arquivo]`.
  - Exemplo `examples/checkout-express`: Express com DI, barrel, tsconfig `paths`, interface `PaymentGateway`, race condition proposital no checkout e Stripe sem timeout. **Mapa 100% provado.** A cadeia `POST /checkout` → `CheckoutController.create` → `CheckoutService.checkout` → `StockRepository`/`OrderRepository` → `pg` e → `StripeGateway.charge` (via interface) está coberta por teste.
  - Bug corrigido: a ligação por interface dependia da ordem de indexação. Agora quem usa uma interface é religado quando uma classe passa a implementá-la, ou deixa de implementar.
  - `references` só aponta para função ou método do projeto. Valores passados como argumento (`req.body`) não viram aresta.
  - README do `shieldepy_p1` atualizado (como uma chamada vira aresta, mapa do código, limites).
  - Suíte: 199 testes.
  - **Medição atual:** `packages/` 99,5%, `apps/` 99,0%, `checkout-express` 100%, sempre com 0 chamadas sem alvo e 0 imports quebrados.
- 2026-10-07: **1d, parte 1: extratores de regras sem regex.**
  - Java/Spring, Python/Django e C#/MediatR foram reescritos sobre a AST Tree-sitter, com `GrammarParser` no core. Gramáticas `tree-sitter-java/python/c_sharp.wasm` foram adicionadas ao `copy-wasm` e ao pacote da extensão.
  - **O que a AST cobre e a regex não cobria:**
    - Java: `@TransactionalEventListener`, `@EventListener(classes = X.class)` e acesso direto a campo/`+=`.
    - Python: `@receiver([pre_save, post_save], ...)` (uma regra por signal), `signal.connect(fn, sender=X)` e `+=`.
    - C#: vários `INotificationHandler<T>` na mesma classe e `++`/`+=`.
    - Em todas as três, comentário e string nunca viram acesso.
  - **PL/pgSQL:** não há gramática Tree-sitter, e as de SQL não entram no corpo `$$`. Por isso foi escrito um analisador léxico (`postgres/lexer.ts`), que cobre:
    - comentários aninhados, strings `'...'`/`E'...'` e identificadores com aspas;
    - dollar-quote: o corpo da função é código, e SQL dinâmico é string;
    - `NEW.x = …` no início de um comando como atribuição, mas não dentro de um `IF`;
    - nome sem aspas convertido para minúsculas.
  - **Fallback regex removido:**
    - A pasta `extractors/src/regex/` foi apagada.
    - `createRegistry` só registra linguagens com gramática carregada. O novo `loadRegistry(wasmDir)` carrega tudo e reporta `failed`.
    - CLI, web, extensão do VS Code e testes foram migrados. A extensão chamava `createRegistry()` sem parser e ficaria sem Java/Python/C# em silêncio.
  - Os testes antigos de regex foram trocados por `languages.test.ts`, com as mesmas expectativas mais os casos novos. Os 4 cenários de exemplo (TS/Java/Python/C#) continuam com as 3 colisões plantadas.
  - Suíte: 196 testes. A extensão compila (`build:vscode`) e empacota as 6 gramáticas.
- 2026-10-07: **1d concluído, e com ele a E1.**
  - HTML/CSS do grafo também passaram para a AST: gramáticas `tree-sitter-html/css`, carregadas pelo `CodeGraph.create` (sem uma delas, aquele tipo de arquivo fica fora do grafo).
  - **O que a AST resolve sozinha:** pseudo-classe (`.a:hover`), seletores em `@media`/`:is()`, comentário HTML, atributo sem aspas ou em maiúsculas, `<link/>` auto-fechado e as duas formas de `@import`.
  - `resolveWebRef` e `parseJsonc` (tsconfig) também deixaram de usar regex. O `parseJsonc` agora sabe quando uma vírgula está dentro de uma string.
  - Regex que restou no core/extractors: só manipulação de caminho de arquivo (`\` → `/`). Nenhuma lê código.
  - Suíte: 199 testes. Typecheck limpo, e a extensão compila e empacota as 8 gramáticas.
  - Não rodado: o E2E da extensão (`apps/vscode/test-e2e`), que baixa um VS Code real.
- 2026-10-07: **V1, visualizador de conferência** (branch `feat/grafo-visualizador`, criada a partir da `feat/chaos-grafo`; fazer o merge dela DEPOIS da E1).
  - `shieldepy graph --html` gera Cytoscape.js mais `fcose`, embutidos.
  - Conferido em screenshots no Chrome headless: mapa, modo fluxo do `checkout-express` e o grafo grande de `apps/`.
  - Bug encontrado nessa conferência: o modo fluxo descartava o arquivo de rotas, que é a origem das `references`.
  - Teste da CLI confere bibliotecas e dados embutidos e que o script compila. Suíte: 200 testes.
- 2026-10-07: **E2 contextualizada.** A seção "Fase 1 / E2" foi reescrita sobre o que a E1 entregou:
  - rota detectada pelo receptor (`pkg:express`) e não pelo nome do método;
  - handler já presente como `references`/callback;
  - I/O a partir das chamadas resolvidas para pacotes;
  - formato canônico e hash do `SystemGraph`.
  - **API nova necessária no core:** `RawCall` com linha e 1º argumento literal, `callsOf()` em ordem de código e `referencesAt()`.
  - **Mudança estrutural:** o lexer SQL vai de `extractors` para o core.
  - **Aceitação:** a topologia esperada do `checkout-express` está escrita na seção.
- 2026-10-07: o plano passou a registrar o que a extensão mapeia hoje (com 5 ressalvas) e a estimativa de custo da IA por execução (seções próprias).
- 2026-10-07: **ressalvas 2–5 da extensão resolvidas.** Detalhes na seção "Extensão do VS Code". O E2E passa 23/23 num VS Code real, e a suíte unitária tem 201 testes.
- 2026-10-07: avaliado o esforço de mapear Java/C#/Python por completo (seção própria). Ficou registrado como E5, depois da E2.
- 2026-10-08: **E1 e V1 mergeadas na `main`** (PRs #1 e #2), seguidas do commit `6756ded` (`apps/web` → `apps/frontend`, em React).
  - Conferido na `main`: typecheck limpo, **204 testes** passando e o gate da E1 no `checkout-express` (`callsUnresolved = 0`, `callsHeuristic = 0`, `importsUnresolved = 0`).
  - Pasta local `legado_grafo_arvore/` apagada (já não era versionada). O README da raiz descreve só o `shieldepy_p1`; os legados ficam no histórico do git.
  - Achado: `npm run cli -- …` não imprimia nada, porque o script `start` rodava `src/main.ts`, que só exporta `main()`. Corrigido: o `start` usa o `bin/shieldepy.js`.
  - Branch `feat/topologia` criada a partir da `main`. **E2 iniciada.**
- 2026-10-08: **2a concluído (API do core).** Três ajustes ao que o plano previa, vindos da leitura do código:
  - **Chamadas no topo do arquivo** não eram registradas, e `checkoutRouter.post('/checkout', ...)` fica no topo. Agora ficam guardadas com o arquivo como chamador, mas **fora das arestas e da cobertura**: os números da E1 e o hash do mapa do `checkout-express` não mudaram.
  - **`args` no lugar de só `firstArg`:** a 2c precisa do 2º argumento (`fetch(url, { signal })`, `axios(url, { timeout })`). Cada argumento vira um resumo estático: string, prefixo de template, chaves de objeto, callback (com o símbolo) ou nome resolvido.
  - **`callSitesIn(fileId)` no lugar de `referencesAt`:** a mesma API serve para o topo do arquivo e para dentro de funções (o `app.use(router)` fica dentro de `createApp`). Cada nome traz a **`origin`**, ou seja, onde ele é declarado, atravessando import e barrel. É isso que liga o `app.use('/api', r)` de um arquivo ao `ordersRouter.post` de outro.
  - **Ordem:** pela posição em que a chamada **termina**. Em `res.status(201).json()` e `fetch(url, { body: new URLSearchParams() })`, a de dentro roda antes.
  - Saída de `callsOf`/`callSitesIn`: `{ caller, line, column, name, object, outcome, targets, package, shadowed, receiverOrigin, args }`. O `outcome` vale `resolved | heuristic | unresolved | external | unbound`. `fetch` global sai `unbound` sem `shadowed`.
  - O lexer SQL foi movido para `packages/core/src/sql/lexer.ts` e é exportado como `tokenizeSql`; `extractors` importa de lá.
  - Suíte: 204 → **210 testes**. Typecheck limpo e a extensão compila.
- 2026-10-08: **2b concluído (rotas Express)**, em `packages/core/src/topology/routes.ts` (`findExpressRoutes`).
  - **Roteador:** qualquer valor cujas chamadas resolvem para `pkg:express` (`express()`, `Router()`, `express.Router()`, `require('express')`). A identidade dele é a `origin` (onde é declarado), ou `this.router` dentro do arquivo.
  - **Rota:** `get|post|put|patch|delete|head|options|all` com path literal e pelo menos um handler. `app.get('env')` é leitura de configuração e não entra. Path dinâmico vai para `skipped`, com motivo.
  - **Montagem:** `use([prefixo], x)` em que `x` é um roteador conhecido. A rota sobe pelas montagens somando prefixos; um roteador montado duas vezes gera duas rotas, e ciclo de montagem não trava.
  - **Middlewares:** os outros argumentos de `use` entram na cadeia, mas só os registrados **antes** (no mesmo arquivo) e dentro do prefixo, que é a semântica do Express. Middleware de pacote sai com `package`. Chamada (`express.json()`, `auth()`) sai `opaque`: aparece na cadeia, mas o percurso não entra. Para isso, `CallArg` ganhou o tipo `call` (`callee`).
  - **`checkout-express`:** `POST /checkout: express.json() → validateCheckout → checkoutController.create` e `GET /orders/:id: express.json() → <inline>`. O `express.json()` vem do `app.use` de `app.ts`, que fica antes da montagem, e por isso está certo.
  - **Limite (da E1, não da 2b):** campo sem anotação iniciado por chamada (`router = Router()`) não tem tipo, então `this.router.post` não é reconhecido. Com anotação (`router: Router = Router()`), é. Também ficam de fora `router.route('/x').get(...)` e roteador recebido como parâmetro (`register(r: Router)`), que sai sem o prefixo de quem chama.
  - Suíte: **216 testes**.
- 2026-10-08: **2c concluído (operações de I/O)**, em `topology/io.ts` (`ioOperationOf`) e `sql/classify.ts` (`classifySql`).
  - **SQL pelos tokens:**
    - verbo principal no nível de fora (o de uma CTE ou subconsulta não conta);
    - tabela escrita (INTO/UPDATE/DELETE FROM) ou a 1ª lida, e todas as citadas, sem as CTEs;
    - `FOR UPDATE/SHARE/NO KEY UPDATE` vira `lock`;
    - BEGIN/COMMIT/ROLLBACK vira `db_tx`;
    - nome sem aspas em minúsculas e `schema.tabela` junto;
    - comentário e string nunca viram verbo.
  - **pg:** `query` resolvida para `pkg:pg`, inclusive o `client` de `pool.connect()`. Um `query` de classe do projeto não é banco.
  - **Prisma:** o model é o último segmento do receptor (`prisma.order.create`). `find*/count/aggregate/groupBy` é leitura e `create*/update*/upsert/delete*` é escrita. `$transaction` vira `db_tx`, e `$queryRawUnsafe/$executeRawUnsafe` passam pelo classificador de SQL.
  - **fetch:** o global (não sombreado) e o de `node-fetch/undici/cross-fetch`. O alvo é o host da URL literal ou do começo do template; se não der para ler, `dynamic`.
  - **axios:** a posição da config depende do método (`get(url, config)`, `post(url, data, config)`, `axios(config)`).
  - **Timeout em 3 estados**, porque a tag `no-timeout` só sai com `no`:
    - `yes`: há `signal` ou `timeout`;
    - `no`: config ausente ou sem essas chaves;
    - `unknown`: a config é uma variável ou spread, ou a chamada é de uma instância `axios.create(...)`, que pode ter timeout próprio.
  - SQL que não é literal (`db.query(sql)`) vira `db_unknown dynamic`: fala com o banco, mas não se sabe o quê.
  - **`checkout-express`:** `api_call api.stripe.com (fetch, sem timeout)`, `db_read stock`, `db_write stock`, `db_write orders` e `db_read orders`, cada uma no método certo do repositório.
  - Suíte: **223 testes**.
- Decisão: nada de regex para ler código. O grafo e os extratores novos são 100% Tree-sitter, e os extratores de regras que ainda usam regex migram no marco 1d.
- Confirmado com o usuário: o motor marca os nós críticos; o Threat Modeler é o 1º nó do LangGraph e roteia hipóteses para especialistas por tipo de erro.

---

## Visualização do grafo

**V1, feito agora (ferramenta de conferência).** `shieldepy graph <pasta> --html mapa.html` gera um HTML autocontido que lê só o `SystemGraph` (o contrato da E1).
- **Biblioteca:** Cytoscape.js 3.30 com o layout `cytoscape-fcose`, próprio para nós compostos (arquivo contendo símbolos). As bibliotecas vão embutidas, sem CDN, e o HTML abre offline.
- **Recursos:**
  - cobertura, busca, filtros por tipo de aresta, pacotes e testes;
  - pontos fracos clicáveis;
  - modo fluxo ("Cadeia abaixo" / "Quem chega aqui", em camadas);
  - link direto `#fluxo=<id>` e `#foco=<id>`.
- **Medido:** o grafo de `apps/` (~1.400 nós) renderiza em ~2 s no Chrome. A visão geral de um sistema grande serve para orientação; a leitura de verdade é pela busca e pelo modo fluxo.

**V2, necessário para depois, quando a topologia estiver pronta (depois da E2).**
- **Onde:** dentro da extensão (webview) e no portal, consumindo o `topology-graph.json`.
  - Visão por **rota**, com as operações de I/O como nós próprios (`db_write orders`, `api_call stripe`) e as tags de sensibilidade.
- **Sobreposição dos resultados da E4:** rota vermelha quando o teste de caos quebra, com link para o teste e o relatório.
- **Diff entre dois mapas** (hash do PR × `main`): o que o PR adicionou ou mudou na cadeia.
- **Escala:** para repositórios de 10k+ nós, avaliar o **Sigma.js** (WebGL, usa o `graphology` que o core já usa), e para fluxos em camadas o **ELK** (`elkjs`). O contrato `SystemGraph` não muda.
- **Na extensão:** respeitar a CSP do webview já existente (scripts com nonce, sem inline) e empacotar as bibliotecas no `esbuild`.

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

## Fase 1 / E2 — Topologia determinística (`packages/core/src/topology/`)

> Reescrita em 2026-10-07 com base no que a E1 entregou. A versão original previa extrair rotas e I/O casando nomes de métodos. Com o grafo da E1, a detecção passa a ser **semântica**: o grafo sabe de onde vem cada receptor.

### O que a E1 já entrega e a E2 reaproveita

| Peça da E1 | Uso na E2 |
|---|---|
| **Receptor resolvido para pacote.** `const router = Router()` / `express()` → `pkg:express`; `this.db.query()` com `db: Pool` → `pkg:pg` | **Rota** = chamada `.get/.post/...` cujo receptor resolve para `express`, e não qualquer método `post`. **I/O de banco** = chamada resolvida para `pg`, `@prisma/client` etc. |
| **Callback inline vira símbolo** (`checkoutRouter.get('/orders/:id')`) e **handler passado como valor vira `references`** | O handler de cada rota já está no grafo. Falta associar cada argumento ao `method` e `path` da chamada que o registrou. |
| **Interfaces, herança e retorno** já resolvidos (`PaymentGateway` → `StripeGateway`) | O percurso da rota chega à implementação real (onde está o `fetch`). |
| **`SystemGraph`** com ids relativos, `canonicalJson` e `contentHash` | O `topology-graph.json` usa o mesmo formato canônico e hash. O `serialize.ts` previsto não é mais necessário. |
| **`weakSpots`/cobertura** | A topologia informa a confiança. Uma operação alcançada por aresta `heuristic` sai marcada, e o Threat Modeler (E3) a vê assim. |
| **Tokenizador SQL/PL-pgSQL** (`extractors/src/postgres/lexer.ts`) | Classificar o SQL de `pool.query('...')` (verbo + tabela) **sem regex**. Precisa **mudar para o core** (`packages/core/src/sql/lexer.ts`), porque o core não importa de `extractors`. |
| **Visualizador V1** | Conferir a topologia visualmente. O V2 é a visão por rota. |

### O que falta no core (API nova do `CodeGraph`)

Hoje a resolução de cada chamada é interna (`resolveCall`), e as arestas juntam várias chamadas num `caller→target` só. A E2 precisa de **cada chamada, em ordem de código**:
- **`RawCall` passa a guardar `line`/`column`** e, quando for literal estático, o **1º argumento** (`'/checkout'`, `'SELECT ...'`, `'https://api.stripe.com/...'`). Isso é capturado no mesmo parse, sem segundo parse.
- **`graph.callsOf(symbolId)`** devolve as chamadas resolvidas em ordem de linha: `{ line, name, object, outcome, targets, package?, firstArg? }`. É a base do percurso em ordem de execução aproximada e da ordem das operações (necessária para `read-then-write` / `write-after-api-call`).
- **`graph.referencesAt(fileId)`** devolve os registros de handler do topo do arquivo, com a chamada que os registrou (método + path + ordem dos argumentos).

### Tarefas

- **2a. API do core.** ✅ Concluída em 2026-10-08. Saiu como `args` + `callSitesIn` + `origin`; ver o registro.
  - `line`/`firstArg` no `RawCall`, mais `callsOf` e `referencesAt`.
  - Mover o lexer SQL para o core; `extractors` passa a importar de lá.
  - Testes no `call-resolution.test.ts`.
- **2b. Rotas Express** (`topology/routes.ts`): ✅ Concluída em 2026-10-08.
  - Registrar com receptor resolvido para `pkg:express`, verbos `get|post|put|patch|delete|all` e path literal.
  - Montagem com prefixo `app.use('/api', router)`, seguindo `router` importado até a sua declaração. Compor os prefixos.
  - Cada rota guarda os handlers **em ordem** (middlewares + handler final).
- **2c. Operações de I/O** (`topology/io.ts`), por chamada: ✅ Concluída em 2026-10-08.
  - `pg` (`query` com SQL literal): o tokenizador dá o verbo (`SELECT` → `db_read`; `INSERT/UPDATE/DELETE` → `db_write`), a tabela e `FOR UPDATE`/transação (`BEGIN`) anotados.
  - `@prisma/client` (`prisma.<model>.<op>`): `create|update|upsert|delete*` = write; `find*|count|aggregate` = read; `$transaction` anotado.
  - `fetch` global (não sombreado) e `axios` (`pkg:axios`): `api_call`, alvo = host da URL literal, ou `dynamic`. Anotar timeout presente ou ausente (`AbortSignal.timeout`, `signal`, `timeout:` do axios).
- **2d. Topologia** (`topology/build.ts` + `types.ts`):
  - Para cada rota, percorrer handlers em ordem → `callsOf` em ordem de linha, em profundidade (limite de profundidade, sem repetir nó).
  - Gerar a lista ordenada de operações e as `SensitivityTag`s:
    - `external-io`;
    - `read-then-write` (mesmo alvo);
    - `multi-write-same-target`;
    - `write-after-api-call`;
    - `no-timeout` (api sem timeout);
    - `no-transaction` (read-then-write fora de transação/lock).
  - Anexar os baldes com colisão do `SystemGraph`.
  - `confidence` por operação: `proven` ou `heuristic`, conforme as arestas usadas.
- **2e. Superfície de ataque + CLI.**
  - `attackSurface(topology)`: só rotas com I/O e baldes com colisão. É isto, e não o código, que vai para a IA.
  - `shieldepy topology <pasta> [--json] [--out .shieldepy/topology-graph.json]`.
  - O `--html` do V1 mostra rotas e operações como nós.
- **2f. Extensão (pequeno).** Comando "ShielDepy: Exportar topologia" usando o `WorkspaceModel` (grafo + regras já em memória).

### Resultado esperado no `checkout-express` (é o teste de aceitação da E2)

```text
POST /checkout   handlers: validateCheckout → CheckoutController.create
  1 db_read   stock   (StockRepository.available)    pg
  2 api_call  api.stripe.com (StripeGateway.charge)  fetch, sem timeout
  3 db_write  stock   (StockRepository.decrement)    pg
  4 db_write  orders  (OrderRepository.insert)       pg
  tags: external-io, read-then-write(stock), write-after-api-call, no-timeout, no-transaction
GET /orders/:id  handlers: <inline>
  1 db_read   orders  (OrderRepository.findById)     pg
```

Faltam também exemplos pequenos de Prisma e axios (fixtures nos testes) para cobrir as outras vias.

### Fora do escopo da E2 (anotado)
- **Outros frameworks:** NestJS (decorators), Next.js (rotas por arquivo), Fastify. A detecção é pelo receptor/pacote, então entram como novas "fontes de rota" sem mudar o formato.
- **Outros bancos:** ORMs (TypeORM, Sequelize, Knex) e Redis/filas como I/O. Seguem o mesmo padrão: pacote + método → operação.

## Extensão do VS Code: o que ela mapeia hoje (conferido no código em 2026-10-07)

Ao ativar, a extensão:
- carrega as gramáticas Tree-sitter (TS/TSX/HTML/CSS no `CodeGraph`; Java/Python/C# no `loadRegistry`);
- indexa até **3000 arquivos** (`indexWorkspace`), ignorando `node_modules`, `dist` etc. e arquivos maiores que 2 MB;
- mantém o grafo atualizado ao digitar, salvar, mudar no disco (git checkout) e apagar.

É o **mesmo código do core** que a CLI usa, então a qualidade medida (99–100% das chamadas provadas) vale para ela.

**Ressalvas** (as de 2 a 5 foram resolvidas em 2026-10-07, branch `feat/grafo-visualizador`):
1. **Só TS/JS tem grafo de chamadas.** Java/Python/C# geram apenas regras de evento (colisões). Ver "Grafo de chamadas para outras linguagens", abaixo.
2. ~~Teto de 3000 arquivos sem aviso.~~ Resolvido.
   - A configuração `shieldepy.index.maxFiles` define o teto (padrão 3000).
   - Ao passar do teto, a extensão avisa que o mapa ficou PARCIAL, com atalhos para ajustar o teto ou excluir pastas.
   - A cobertura também vai para o log.
3. ~~`tsconfig` sem invalidação.~~ Resolvido.
   - A extensão observa `**/{tsconfig,jsconfig}*.json`.
   - Quando um deles muda, `CodeGraph.reloadModuleConfig()` refaz imports e chamadas sem reparsear.
   - `@/…`, `~/…` e `#…` que não resolvem passam a contar como import quebrado, e não como pacote.
4. ~~Mapa invisível na extensão.~~ Resolvido.
   - Comando **"ShielDepy: Ver Mapa do Sistema"**: painel com o mesmo visualizador da CLI e botão "Abrir código".
   - O visualizador virou o pacote `@shieldepy/viewer`, com dois modos: inline (CLI) e webview com CSP por nonce.
   - O Cytoscape injetava um `<style>` que a CSP bloqueava. O estilo agora vai pré-declarado com o nonce.
5. ~~E2E não rodado.~~ Resolvido: **23/23 num VS Code 1.141 real.**
   - Os 19 cenários antigos continuam passando.
   - Novos cenários: workspace com o `checkout-express` mapeado 100%, painel do mapa com a cadeia completa, `tsconfig` alterado ao vivo e teto excedido.
   - Não coberto pelo E2E: o clique em "Abrir código" dentro do webview (o handler de mensagem valida que o caminho fica dentro da raiz).

## Grafo de chamadas para outras linguagens (avaliação de 2026-10-07)

Hoje o mapa completo (símbolos, imports, chamadas resolvidas por tipo, pacotes) existe só para TS/JS. Java, Python e C# já são lidos pela AST, mas só para extrair handlers de evento. As gramáticas Tree-sitter das três já vêm na extensão.

**Pré-requisito comum: separar o motor da linguagem.**
- Hoje a extração e a resolução do `CodeGraph` têm o formato do TS: `extract-ts`, `extract-module`, `resolve-import`, `RawCall` com `receiver`.
- O que já é genérico: a manutenção incremental, a religação, a cobertura, o `SystemGraph` e o visualizador.
- A refatoração é uma interface de linguagem, `LanguageFrontend { symbols, module, calls, resolveModule }`. O TS passa a ser só uma implementação dela.
- Estimativa: **2–4 dias.**

| Linguagem | O que precisa | Dificuldade | Estimativa (1 dev, com testes e exemplo) | Cobertura provada esperada |
|---|---|---|---|---|
| **Java** | `package` + `import` → índice de nome qualificado → arquivo (inclui `import x.*` e o mesmo pacote sem import); tipos são explícitos (campos, parâmetros, `var` só por `new`); herança/`implements`; injeção do Spring (`@Autowired` de interface → implementações); repositório Spring Data (interface sem implementação → externo) | **Média.** É a mais fácil, porque é estaticamente tipada | **1–1,5 semana** | ~95%+ |
| **C#** | `namespace` + `using` (um namespace se espalha por vários arquivos); `partial class` dividida em arquivos; propriedades; métodos de extensão (o 1º parâmetro `this`); `var`; injeção pelo construtor com interface → implementações | **Média-alta** | **1,5–2 semanas** | ~90–95% |
| **Python** | Módulos e pacotes (`__init__.py`, import relativo, raiz do projeto); `self.x()` → classe; `self.repo` tipado por `__init__` (`= Repo()`) ou por type hints; dataclasses; ORM do Django (`Model.objects…` → externo) | **Alta**: tipagem dinâmica, decorators, duck typing | **2–3 semanas** | ~85–90% com type hints; ~70–80% sem (o resto fica `heuristic`, marcado) |

**Para entrar no pipeline de caos**, cada linguagem também precisa da sua "fonte de rotas" e dos detectores de I/O da E2:
- Spring (`@GetMapping`/`@PostMapping`);
- ASP.NET (`[HttpPost]`, minimal APIs);
- Django (`urls.py`) e FastAPI (`@app.post`);
- os detectores de JDBC/JPA, EF Core e Django ORM/SQLAlchemy.

Isso dá **+3 a 5 dias por framework**. O formato da topologia não muda.

**Recomendação:** fazer **depois da E2 em TS**, quando o pipeline estiver provado de ponta a ponta. Ordem sugerida: Java/Spring (melhor retorno; stack comum em empresas) → C#/ASP.NET → Python. Fica como **E5 — outras linguagens**.

## Custo estimado da IA (E3), preços de 2026-10-06

**Agentes LLM no pipeline:**
- **MVP:** 3 nós com IA. O **Threat Modeler** (tier `deep`) e os especialistas **Network** e **Concurrency** (tier `fast`; só preenchem specs estruturadas).
- **Depois:** **DB_Chaos** (4º) e o parágrafo opcional do relatório (5º).
- **Sem IA:** escrever, rodar e gerar o relatório determinístico.
- **Modo `--offline`:** custo zero.

| Modelo | Entrada / 1M tokens | Saída / 1M tokens |
|---|---|---|
| Claude Opus 5.5 | US$ 4,00 | US$ 20,00 |
| Claude Sonnet 5.5 | US$ 2,00 | US$ 10,00 |
| Claude Haiku 5.5 | US$ 0,10 | US$ 0,50 |

**Estimativa por execução.** O raciocínio (thinking) é cobrado como saída. Os números são de ordem de grandeza e devem ser medidos com `response.usage` na E3. Câmbio assumido: R$ 5,50 por dólar.

| Superfície de ataque | Tokens (entrada / saída) | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 | Misto (Threat Modeler Opus + especialistas Haiku) |
|---|---|---|---|---|---|
| Pequena (~2 rotas, ex.: `checkout-express`) | ~8k / ~6k | ~R$ 0,83 | ~R$ 0,42 | ~R$ 0,02 | ~R$ 0,60 |
| Média (~20 rotas sensíveis) | ~30k / ~25k | ~R$ 3,40 | ~R$ 1,70 | ~R$ 0,09 | ~R$ 1,50 |
| Grande (~100 rotas sensíveis) | ~120k / ~80k | ~R$ 11,40 | ~R$ 5,70 | ~R$ 0,30 | ~R$ 5,00 |

**Alavancas de custo, previstas para a E3:**
1. **Rodar só para as rotas cuja cadeia o PR tocou** (diff de hash do mapa). A maioria dos PRs fica com custo zero.
2. **Cache de prompt** no prompt de sistema e no catálogo, que são estáveis.
3. **Especialistas no tier `fast`**, porque só preenchem specs validadas.
4. **Registrar o custo de cada execução no relatório do PR.**

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
- Novo: `packages/core/src/topology/*`, `packages/core/src/sql/lexer.ts` (movido de extractors), `packages/agent/src/chaos/*`, `apps/cli/src/chaos/run.ts`, `.github/workflows/shieldepy-chaos.yml`, `examples/checkout-express*`.
- Alterar: [main.ts](shieldepy_p1/apps/cli/src/main.ts) (comandos `topology`/`chaos`, USAGE), `packages/core/src/index.ts`, `packages/agent/src/index.ts`, `packages/agent/package.json`, [WorkspaceModel.ts](shieldepy_p1/apps/vscode/src/workspace/WorkspaceModel.ts) (registrar extratores no `onParsed`) + comando de export na extensão, `shieldepy_p1/README.md` (seção nova + limites).
- Reusar: `CodeGraph.onParsed`, `getEnclosingSymbol`, `indexFiles`/`listSourceFiles`, `buildGraph`/`findCollisions`, `parseRules` (padrão de validação), `providerFromEnv`, `severityRank`, `gate()` da CLI.

## Verificação
0. **Gate do marco 1 (grafo):**
   - `shieldepy graph examples/checkout-express --json` mostra `callsUnresolved = 0` (atingido no 1c, com `callsHeuristic = 0`).
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
