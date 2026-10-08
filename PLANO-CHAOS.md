# Plano — Chaos Engineering dirigida por Análise Estática (fatia vertical)

## Contexto
Hoje o ShielDepy só prova **colisões entre handlers de evento** (`Rule` → buckets `resource::event`) e **ciclos de chamada** (CodeGraph via Tree-sitter). Não há detecção de rotas HTTP nem de I/O (DB/API), não há export do grafo, não há LangGraph e não há `.github/`. O objetivo é o motor determinístico apontar as rotas sensíveis (`topology-graph.json`), um pipeline LangGraph gerar testes de caos **apenas** para essas rotas, executá-los com Vitest e bloquear o PR quando o código quebra sob falha física.

Decisões tomadas: **LangGraph.js em TS** (dentro de `packages/agent`, sobre o `LLMProvider` existente), alvo **Express + fetch/axios + pg/Prisma**, runner **Vitest** (+ supertest + MSW), entrega **ponta a ponta com `Network_Chaos_Agent` e `Concurrency_Agent`**; `DB_Chaos_Agent` fica para depois.

Princípio mantido do projeto: *o motor prova, a IA propõe*. Toda saída da IA é validada; sem chave de API existe caminho offline determinístico; um teste só conta como falha se passar no **run de controle** (sem caos).

**Ordem de entrega (ajuste pedido):** primeiro aperfeiçoar o mapeamento do sistema em grafos (Fase 0 + Fase 1), com métrica de cobertura e testes. Só depois disso, e com o grafo validado nos exemplos, entram os agentes (Fases 2–4). Cada marco é um PR separado.

## Como retomar num chat novo (atualizado em 2026-10-08, com a E4 completa)

**Onde estamos:** E1, V1, E2 e E3 estão mergeadas na `main` (`ccc11c2`). A **E4 está completa** na branch `feat/chaos-gate` (4a–4e), esperando o usuário subir a branch e fazer o merge. Depois do merge, a única parte da aceitação que falta é o **PR de teste no GitHub** (ver o registro da 4e). As próximas frentes candidatas estão na tabela de progresso: V2 (visualizador de produto, com os resultados do caos), E5 (outras linguagens) e o `DB_Chaos_Agent`. Leia, nesta ordem:
1. esta seção;
2. o fim do **Registro**, para os detalhes de cada fatia (a E4 começa em "E4 iniciada");
3. a seção da etapa que for começar.

**Combinados com o usuário (seguir sem perguntar):**
- Responder **em português**.
- Trabalhar **fatia por fatia** (4a, 4b, ...): cada uma termina com testes passando, este plano atualizado (registro + ✅ na tarefa) e **um commit** no mesmo commit da mudança. Mensagem de commit em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Não fazer push nem abrir PR.** O usuário sobe a branch e faz o merge quando a etapa **inteira** estiver pronta. No fim, avisar e oferecer título e descrição do PR.
- Escolhas técnicas que surgirem: decidir, registrar no plano o porquê e avisar no resumo. Só perguntar o que for realmente do usuário (ex.: gastar dinheiro com chamada paga à IA, mexer no GitHub).
- **Nada de regex para ler código** (só Tree-sitter ou analisador léxico). Regex em texto da IA ou em caminho de arquivo pode.
- O princípio do projeto: **o motor prova, a IA propõe**. Toda saída da IA é validada, existe caminho offline, e um teste só conta como falha se o controle passou.

**Como rodar (de `shieldepy_p1/`):**
- `npm run check`: typecheck + testes unitários (**288** no fim da E4).
- `npm run build:vscode`: extensão (o bundle tem ~612 KB; se crescer muito, algo puxou o LangGraph para dentro dela).
- `npm run test:e2e -w shieldepy`: E2E num VS Code real (**24/24**, leva alguns minutos).
- `npm run cli -- chaos examples/checkout-express --offline [--report chaos-report.md]`: gera e roda os testes de caos e aplica o portão (exit 1 no vulnerável e 0 no `-fixed`). Com `--no-run`, só gera.
- Dentro de um exemplo (`examples/checkout-express` e `-fixed`, que precisam de `npm install` próprio): `npm test` roda o teste de fumaça. Sem esse `npm install`, os testes da CLI e do agent que rodam o Vitest e o `tsc` dos exemplos são pulados.
- Atenção no Windows: os caminhos têm acento e espaço (`Área de Trabalho`), então use sempre aspas. Os arquivos do repositório estão em CRLF, e edições por script que procuram `\n` podem não casar; prefira o editor.

**Ainda não feito, de propósito (não é bug):**
- Os modelos padrão (`fast` e `deep` = Haiku 4.5) não mudaram, porque falta medir com chamada paga.
- `partial_failure` e `retry_storm` não têm teste (aparecem no relatório como "sem teste no MVP", sem bloquear).
- O workflow da E4 nunca rodou no GitHub (depende do push), e nenhum secret `ANTHROPIC_API_KEY` foi configurado: no CI ele roda `--offline` até o usuário decidir pagar pela IA.
- As observações do registro da 3a (5 heurísticas e 2 sem alvo no `packages/` do próprio ShielDepy; `graph apps` lento por causa do `.vscode-test`).

## Progresso e fluxo de trabalho

Este arquivo é atualizado a cada tarefa concluída, no mesmo commit da mudança. Cada etapa tem sua branch. **O merge na `main` é feito pelo usuário** quando a etapa inteira estiver completa.

- **E1 — Mapeamento em grafos** (tarefas 1a–1d, branch `feat/chaos-grafo`): pré-requisito de tudo. O grafo precisa ser completo e confiável antes de qualquer agente. **Completa em 2026-10-07, mergeada na `main` (PR #1).**
- **E2 — Topologia** (tarefas 2a–2f, ver a seção "Fase 1 / E2"), **E3 — Agentes** (tarefa 3), **E4 — Gate de CI** (tarefa 4).
- **Merges feitos:** `feat/chaos-grafo` (E1, PR #1) → `feat/grafo-visualizador` (V1, PR #2).
- **E2 completa e mergeada** (PR #3, `b4eeb7b`).
- **E3 completa e mergeada** (PR #4, `ccc11c2`).
- **E4 completa** na branch `feat/chaos-gate` (criada a partir da `main`, `ccc11c2`): 4a–4e. Falta o usuário subir a branch, fazer o merge e abrir o PR de teste no GitHub.

| Tarefa | Branch | Status |
|---|---|---|
| 1a. Fase 0: imports (tsconfig paths, require, barrels, default, alias, namespace) | `feat/chaos-grafo` | concluído, mergeado |
| 1b. Fase 0: chamadas (this, instâncias, params tipados, references) | `feat/chaos-grafo` | concluído, mergeado |
| 1c. Fase 0: snapshot unificado + exemplo `checkout-express` com 100% de cobertura | `feat/chaos-grafo` | concluído, mergeado |
| 1d. Extratores de regras sem regex: Java/Python/C# para Tree-sitter; PL/pgSQL por analisador léxico; HTML/CSS para Tree-sitter | `feat/chaos-grafo` | concluído, mergeado |
| V1. Visualizador de conferência do mapa (`shieldepy graph --html`) | `feat/grafo-visualizador` | concluído, mergeado |
| 2. E2 / Fase 1: topologia (`topology-graph.json`, rotas, I/O, CLI `topology`), tarefas 2a–2f | `feat/topologia` | concluído, mergeado (PR #3) |
| V2. Visualizador de produto (extensão/portal, com topologia e resultados do caos) | a definir | pendente, depois da E2 |
| 3. E3 / Fases 2–3: LangGraph + agentes (tarefas 3a–3f, ver "E3 — contexto") | `feat/chaos-agentes` | concluído, mergeado (PR #4) |
| 4. E4 / Fase 4: execução, gate, GitHub Actions (tarefas 4a–4e, ver "E4 — contexto") | `feat/chaos-gate` | concluído; falta o merge e o PR de teste no GitHub |
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
- 2026-10-08: **2d concluído (topologia)**, em `topology/build.ts` (`buildTopology`, `sensitivityTags`, `isSensitive`).
  - **Percurso:** handlers em ordem (pulando os `opaque` e os de pacote). Dentro de cada um, as chamadas em ordem, em profundidade.
    - Não há "visitado global": uma função chamada duas vezes conta duas vezes (é o que faz `multi-write` aparecer). Recursão é cortada pela pilha.
    - Limites: profundidade 16 e 5000 passos por rota. Se algum estourar, a rota sai `truncated`.
  - **Confiança:** a operação alcançada por uma ligação `heuristic` sai `heuristic`, e a rota também. Cada operação traz `through`, a cadeia de símbolos do handler até ela.
  - **Tags:** como no plano, com uma decisão anotada. Transação **sem** `FOR UPDATE` tira o `no-transaction`, mas o `read-then-write` continua, porque no READ COMMITTED do Postgres a corrida ainda existe; quem decide é o teste de concorrência. Leitura feita **antes** do `BEGIN` continua desprotegida. Alvo `dynamic` não gera `read-then-write`/`multi-write`.
  - **Colisões:** a rota recebe a colisão quando o percurso passa pelo símbolo que implementa uma das regras (ligação já feita pelo `SystemGraph`). A lista global de colisões traz as rotas de cada uma.
  - **Formato:** `TopologyGraph { version, contentHash, systemGraphHash, stats, routes, skipped, collisions }`, com ids relativos (`relativeIds`, extraído do `system-graph.ts`) e JSON canônico. O hash é o mesmo independente da ordem de indexação.
  - **Aceitação no `checkout-express`: atingida.** `POST /checkout` sai com `db_read stock → api_call api.stripe.com → db_write stock → db_write orders` e as tags `external-io, no-timeout, no-transaction(stock), read-then-write(stock), write-after-api-call(orders,stock)`, tudo `proven`. `GET /orders/:id` sai com `db_read orders`.
  - Suíte: **230 testes**.
- 2026-10-08: **2e concluído (superfície de ataque + CLI + visualizador).**
  - **`attackSurface(topology)`** (`topology/surface.ts`): só as rotas sensíveis (com I/O ou colisão no caminho) e as colisões. Cada operação traz `at: arquivo:linha` (1-based) e `in: função`, sem nenhuma linha de código. Leva o `topologyHash`, para amarrar a resposta da IA a este mapa.
  - **CLI:** `shieldepy topology <pasta> [--json] [--surface] [--out arquivo] [--html arquivo]`. Na saída de texto, cada rota vem com a cadeia de handlers, as operações em ordem com `arquivo:linha` e detalhe (`sem timeout`, `FOR UPDATE`, `por nome`), as tags e os registros que não deu para ler.
  - **Visualizador:** `renderGraphHtml(system, label, mode, topology?)`. Com a topologia, rotas viram nós (ligados aos handlers) e cada operação de I/O vira um nó (`db_write stock`, `api_call api.stripe.com`, ligado ao símbolo que a faz). Também ganha a lista lateral de rotas com as tags, o filtro "rotas e operações de I/O" e o link `#rota=POST /checkout`, que abre o fluxo da rota. Conferido em screenshot no Chrome headless (mapa geral e fluxo do `POST /checkout`). Sem a topologia, o visualizador da E1 continua igual.
  - Suíte: **233 testes**. A extensão compila.
- 2026-10-08: **2f concluído, e com ele a E2.**
  - **Extensão:** comando **"ShielDepy: Exportar Topologia (rotas e I/O)"**. Usa o grafo e as regras que já estão em memória (sem reindexar), grava `.shieldepy/topology-graph.json` na raiz e avisa quantas rotas, rotas sensíveis e operações saíram, com atalhos "Abrir arquivo" e "Ver rotas no mapa". O aviso diz quando o mapa tem chamadas não provadas.
  - O painel **"Ver Mapa do Sistema"** passa a receber a topologia: rotas e operações viram nós também no editor, e o "Abrir código" de uma rota leva ao registro dela.
  - **E2E: 24/24 num VS Code 1.141 real.** O cenário novo exporta a topologia do workspace e confere `POST /checkout` com `db_read stock → api_call api.stripe.com → db_write stock → db_write orders`, as tags, a confiança `proven`, o arquivo igual ao que está em memória e o painel do mapa com a mesma topologia.
  - README do `shieldepy_p1`: seção "Topologia: rotas e operações de I/O", comando na lista da CLI, arquivos no mapa do código e limites conhecidos.
  - Escrita a seção **"E3 — contexto sobre o que a E2 entregou"**: o que a E3 reaproveita, o catálogo × tags, as pendências achadas no código (o exemplo não executa, falta a variante corrigida, o provider não devolve tokens, os modelos padrão, a tabela de custo) e as tarefas 3a–3f com a aceitação.
  - **Estado final da E2:** 233 testes unitários, E2E 24/24, typecheck limpo, extensão compila, e o mapa do `checkout-express` continua com o mesmo hash da E1 (`6801cb46…`). Pronta para o usuário subir a branch `feat/topologia` e fazer o merge.
- 2026-10-08: **E2 mergeada** (PR #3). Branch `feat/chaos-agentes` criada a partir da `main` (`b4eeb7b`). **E3 iniciada.**
- 2026-10-08: **3a concluído (exemplos executáveis).** Três mudanças em relação ao plano, todas por causa do que apareceu ao rodar de verdade:
  - **Banco dos testes: PGlite, não `pg-mem`.** No `pg-mem` 3.0.14, repetir o mesmo `UPDATE` parametrizado dava valores errados (5 → -4 → 5 → -4). Um teste de caos que acusa "estoque negativo" não pode depender disso. O PGlite (`@electric-sql/pglite`) é Postgres de verdade em WASM, no mesmo processo. Tem uma conexão só, mas a corrida do checkout acontece **entre** consultas (lê → `await` Stripe → grava), então se reproduz igual.
  - **A variante corrigida reserva o estoque antes de cobrar**, num `UPDATE ... WHERE quantity >= $2` atômico, com compensação se a cobrança falhar, em vez de `FOR UPDATE` + transação. O PGlite tem uma conexão só, então não dá para testar trava de linha entre conexões. Além disso, "reservar primeiro" é o idioma mais comum em produção. O `FOR UPDATE` continua coberto pelos testes de `sensitivityTags`.
  - **`shieldepy.chaos.config.ts` ganhou `requests`**: uma requisição válida por rota (id da topologia). A IA vê a superfície, mas não sabe montar um corpo válido; sem isso todo teste de caos pararia no `400` da validação. O contrato fica `{ createApp, setupFiles, reset, invariants, requests }`.
  - **`checkout-express`** (o código de produção não mudou, só o `findById` abaixo):
    - `chaos/db.ts`: PGlite com o schema e um `Pool` mínimo compatível com o `pg`;
    - `chaos/setup.ts`: `vi.mock('pg')` aponta para esse `Pool`;
    - `shieldepy.chaos.config.ts`, com `stockNeverNegative` e `atMostOneOrder`;
    - `vitest.config.ts` com o alias `@/`;
    - tsconfig em `moduleResolution: Bundler`, para o `tsc --noEmit` que a 3e vai usar.
  - **Teste de fumaça do vulnerável:** o defeito é real. 10 compras simultâneas do último item vendem mais de uma vez e deixam o estoque negativo.
  - **`checkout-express-fixed`:** reserva atômica, compensação, `AbortSignal.timeout(5000)` e falha do Stripe → `502`. O teste de fumaça confere exatamente 1 venda em 10, Stripe `503` → `502` com o estoque devolvido, e resposta inválida → `502`. A topologia dela é `db_write stock → api_call (timeout yes) → db_write stock (compensação) → db_write orders`, com as tags `external-io, multi-write-same-target(stock), write-after-api-call`: sem `read-then-write`, `no-transaction` nem `no-timeout`. Isso ficou fixado num teste da E2.
  - **Bug real do exemplo corrigido:** o `findById` fazia `SELECT *` e devolvia `product_id`/`charge_id`, mas o tipo `Order` promete `productId`/`chargeId`. Agora usa alias no SQL, na mesma linha, e a topologia não mudou.
  - **O grafo melhorou (achado no caminho):** o teste de fumaça chamava `config.reset()` / `config.invariants.x()` / `config.createApp()` e caía em heurística.
    - Métodos de objeto literal agora têm contêiner com caminho (`default`, `default.invariants`).
    - Propriedade abreviada ou que aponta para um nome (`{ createApp }`, `start: seed`) é seguida pelo novo `ModuleInfo.objectRefs`.
    - Chave entre aspas perde as aspas no nome.
    - Bug antigo corrigido: o `extract-module` comparava nós do Tree-sitter com `===`, o que nunca é verdadeiro no `web-tree-sitter`, então `export default new Svc()` nunca registrava o tipo.
    - Os dois exemplos saem **100% provados**. No `packages/` do próprio ShielDepy, 1153 → 1162 resolvidas, sem piora.
  - **Observação para depois:** o `packages/` do ShielDepy tem 5 chamadas heurísticas e 2 sem alvo, vindas de código da E2 (`CodeGraph.ts`, `system-graph.ts`, `build.ts`, testes). Não bloqueia nada. Também: o `shieldepy graph apps` fica lento porque varre `apps/vscode/.vscode-test` (o VS Code baixado pelo E2E), que não está entre as pastas ignoradas.
  - O E2E não copia mais o `node_modules` do exemplo para o workspace de teste.
  - Suíte: **236 testes**. E2E 24/24. Os testes de fumaça dos exemplos: 3/3 no vulnerável e 4/4 no corrigido (`npm test` dentro de cada exemplo).
- 2026-10-08: **3b concluído (tokens e custo).**
  - **Provider:** `LLMProvider` ganhou `completeWithUsage` (opcional), que devolve `{ text, model, usage }`. Quem usa `complete` não muda nada (são seis lugares). `completeDetailed(provider, req)` cai no `complete` quando o provider não tem a versão com tokens (ex.: os falsos dos testes); aí o custo sai como desconhecido.
    - **Anthropic:** `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` e o modelo que respondeu de fato.
    - **Gemini:** `usageMetadata`, com os tokens de raciocínio somados à saída (são cobrados assim).
  - **Cache de prompt:** `CompletionRequest.cacheSystem` manda o `system` como bloco com `cache_control: ephemeral`. O Threat Modeler vai usar isso no system + catálogo, que são estáveis.
  - **Custo:** `agent/src/cost.ts`, com a tabela de preços conferida (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 4.5; aceita id com data), `costUsd` (cache de escrita a 1,25×) e o `CostMeter`, que soma uma execução. Modelo sem preço (Gemini, ou um Claude fora da tabela) vai para `unpriced`, nunca com um preço inventado. Chamada sem tokens vai para `withoutUsage`.
  - **Tabela de custo do plano corrigida:** o "Haiku 5.5" a US$ 0,10/0,50 não existe; o Haiku 4.5 custa US$ 1/5, e as estimativas foram recalculadas.
  - **Não feito de propósito:** os modelos padrão (`fast` e `deep` = Haiku 4.5) não mudaram. Trocar o `deep` afeta o custo do chat e da revisão que já existem, e a decisão depende de medir o Threat Modeler de verdade, o que exige chamada paga à API. O Threat Modeler aceita `SHIELDEPY_DEEP_MODEL`.
  - Suíte: **242 testes**.
- 2026-10-08: **3c concluído (catálogo, hipóteses, Threat Modeler e grafo).** Código em `packages/agent/src/chaos/`, exposto como `@shieldepy/agent/chaos`.
  - **Decisão de desenho ("o motor prova, a IA propõe"):** o motor gera a **lista-base** de hipóteses direto das tags, com toda falha do catálogo que cada rota habilita. **A IA não pode tirar nada dessa lista.** Ela explica (o texto vai para o relatório), muda a prioridade e pode acrescentar falhas do catálogo que a base não inclui por padrão (`retry_storm`). Assim, uma resposta ruim da IA nunca some com um teste importante.
  - **`catalog.ts`:** as 6 falhas, cada uma com o agente, o que a habilita e em qual alvo (host ou tabela), se entra na lista-base e se tem teste no MVP. `retry_storm` (fora da base) e `partial_failure_after_external_call` (que precisa do DB_Chaos) ficam sem teste. Host `dynamic` não gera hipótese de rede, porque não se sabe o que mockar.
  - **`hypotheses.ts`:** `baselineHypotheses`, `parseThreatModel` (descarta, com o motivo: rota fora da superfície, falha fora do catálogo, falha que as tags não habilitam, alvo inventado, repetida) e `mergeHypotheses`. O id é estável (`POST /checkout__race_condition__stock`) e vira o nome do arquivo de teste.
  - **`threat-modeler.ts`:** tier `deep`, `json`, `cacheSystem` (o system com o catálogo é estável). Entra só a superfície em JSON canônico, sem código; um teste confere isso. Sem provider, com resposta inválida ou com a IA fora do ar, fica a lista-base e o motivo vai para `errors`. A chamada entra no custo mesmo quando a resposta é descartada.
  - **`graph.ts`:** `ChaosState` (`Annotation.Root`) e `START → threat_modeler → END`. A API do LangGraph 1.4 (`Annotation`, `StateGraph`, fan-out por `Send`) foi conferida num grafo mínimo antes de usar.
  - **Resultado no `checkout-express` (offline):** `race_condition(stock)` e `timeout(api.stripe.com)` com prioridade 1; `partial_failure(orders, stock)` sem teste; `5xx` e `malformed_response` do Stripe. O `GET /orders/:id` não gera nada. No `checkout-express-fixed` some o `timeout` (o Stripe tem timeout), e a corrida continua para provar a correção.
  - **Bundle da extensão:** exportar o caos do índice do `@shieldepy/agent` levava o LangGraph para dentro da extensão (611 KB → 1,9 MB). Por isso ele ficou num subcaminho, e a extensão continua com 612 KB.
  - Suíte: **250 testes**.
- 2026-10-08: **3d concluído (especialistas Network e Concurrency).**
  - **A IA não escreve código nem vê dados:** cada especialista (tier `fast`, system em cache) recebe uma hipótese, a rota e **os nomes** dos invariantes do projeto, e só ajusta uma spec que já nasce válida (o padrão do motor). O corpo da requisição vem do `requests` do config.
  - **`specs.ts`:**
    - `NetworkSpec`: host e uma falha, que é `delay` (timeout), `status` (500/502/503/504) ou `malformed` (`html`, `truncated_json`, `empty`, `wrong_shape`).
    - `ConcurrencySpec`: requisições em paralelo, de 2 a 50.
    - Invariantes: `statusIn`, `respondsWithin`, `noUnhandledError` (nenhum 500), `maxSuccesses` e `stateCheck(nome)`, este só com os nomes declarados no config.
    - `parseSpec` limita as faixas, descarta o que não vale (com o motivo) e garante duas coisas: os invariantes do projeto sempre entram (a IA pode acrescentar, não esquecer) e, no timeout, o atraso injetado sempre passa da paciência do cliente.
  - **Padrões do motor:**
    - timeout: atraso de 15 s e paciência de 6 s;
    - 5xx: `503`, sem 500, status em 502/503/504;
    - corpo inválido: HTML, sem 500, status 502;
    - corrida: 10 em paralelo, sem 500;
    - todos com os `stateCheck` do projeto.
    - O padrão foi escolhido para separar os dois exemplos: o vulnerável quebra (fica pendurado, ou 500 no `response.json()`), e o corrigido responde 502.
  - **Grafo:** `threat_modeler → (Send, uma por hipótese testável) → network | concurrency → END`. As specs saem em ordem estável (a das hipóteses), independente de qual ramo paralelo termina primeiro. IA fora do ar num especialista: fica a spec padrão e o erro é registrado.
  - Suíte: **257 testes**.
- 2026-10-08: **3e concluído (templates, escrita e compilação).**
  - **Resultado de ponta a ponta (gerado pela pipeline offline e rodado com o Vitest de cada exemplo):**

    | | controle | caos |
    |---|---|---|
    | `checkout-express` | 4/4 passam | **4/4 falham**: corrida (`stockNeverNegative`), timeout (6 s sem resposta), 5xx e corpo inválido (a rota **fica pendurada**) |
    | `checkout-express-fixed` | 3/3 passam | **3/3 passam** (sem hipótese de timeout, porque o Stripe já tem timeout) |

  - **Bug real achado pelo caos, que não foi plantado de propósito:** com o Stripe respondendo 503 ou um corpo inválido, o checkout vulnerável nunca responde. A cobrança volta sem `id`, o `INSERT` falha por `NOT NULL`, o erro escapa de um handler `async`, e o Express 4 não captura rejeição de promise. O corrigido responde 502.
  - **Contrato (mais um ajuste):** o `shieldepy.chaos.config.ts` ganhou **`apis`** (host → corpo de uma resposta saudável). O controle e os testes de concorrência precisam das APIs externas respondendo normalmente, e só o projeto sabe qual é a resposta normal.
  - **Contrato lido pela AST:** `readChaosConfig` (`core/src/chaos-config.ts`) extrai os nomes de `invariants`, `requests` e `apis`, os `setupFiles` e a presença de `createApp` e `reset`. Nada é executado: importar o config carregaria o app inteiro, e os aliases do projeto quebram fora do bundler dele. Aceita objeto direto, `defineX({...})`, `satisfies` e `const c = {...}; export default c`.
  - **`templates.ts`:** um `.spec.ts` por spec em `.shieldepy/chaos-tests/`, com nome seguro derivado do id da hipótese. Cada arquivo tem:
    - **controle** (`CONTROL_TEST_NAME`) e **caos**, com o MSW respondendo normal (com 50 ms de latência, senão as requisições simultâneas nem se sobrepõem) e a falha injetada só no caos;
    - uma asserção por invariante, com mensagem legível (inclusive "a rota não respondeu em X ms");
    - o contrato acessado por um tipo solto, para compilar com qualquer config que siga o formato;
    - os dados entrando só por `JSON.stringify` (a IA nunca escreve código).

    Também gera um `vitest.config.ts`, que herda a config do projeto (aliases) e roda só os testes de caos, e um `tsconfig.json`, que herda o do projeto. Contrato incompleto vira aviso (`warnings`).
  - **Grafo:** `especialistas → render → write → END`. A escrita é por `ChaosIo` injetado; sem ele, os arquivos ficam só no estado.
  - **Testes gerados compilam contra o projeto de verdade:** o teste roda o `tsc -p .shieldepy/chaos-tests` dentro de cada exemplo. Ele precisa do `npm install` nos exemplos e é pulado sem isso; **o CI da E4 tem que instalar.**
  - A pasta `.shieldepy/` ficou fora do mapa (indexador e extensão) e do git.
  - Suíte: **264 testes**.
- 2026-10-08: **3f concluído, e com ele a E3.**
  - **CLI:** `shieldepy chaos <pasta> --no-run [--offline] [--json]`. Lê o contrato pela AST, monta topologia → superfície → LangGraph, apaga `.shieldepy/chaos-tests/` e regera do zero (teste de hipótese que sumiu não fica para trás), e imprime:
    - as hipóteses, com prioridade, origem (`motor`, `ia` ou `motor+ia`) e o porquê;
    - as que não têm teste no MVP, com o motivo;
    - as propostas da IA descartadas;
    - os avisos de contrato e os erros da IA;
    - o **custo** (chamadas, tokens, cache, US$, modelos sem preço) e o `topologyHash`.
  - Sem `shieldepy.chaos.config.ts`, o comando sai com código 2 e mostra o modelo do arquivo. Sem `--no-run`, sai com 2 avisando que rodar é a E4, em vez de fingir que rodou.
  - **"Por quê" offline:** cita só as evidências do alvo, por exemplo: corrida em `stock` → `no-transaction(stock), read-then-write(stock), db_read em available, db_write em decrement`.
  - **Aceitação da E3: atingida.**
    - Offline, o comando gera `POST__checkout__race_condition__stock.spec.ts` e `POST__checkout__timeout__api.stripe.com.spec.ts` (mais os de 5xx e de corpo inválido). Todos compilam contra o exemplo e têm o bloco de controle.
    - As hipóteses da IA passam pela validação, e o que é descartado aparece no relatório (testado com provider falso; **não houve chamada paga**).
    - O `GET /orders/:id` não gera teste.
    - O relatório traz o custo e o `topologyHash`.
  - Suíte: **267 testes**. E2E 24/24. A extensão continua com 612 KB.
  - **Estado final da E3:** pronta para o usuário subir a branch `feat/chaos-agentes` e fazer o merge.
- 2026-10-08: **E3 mergeada** (PR #4, `ccc11c2`). Branch `feat/chaos-gate` criada a partir da `main`. O plano ganhou a seção "Como retomar num chat novo", e o contexto da E4 foi refinado com o formato do reporter JSON do Vitest, medido nos testes gerados (ver "E4 — contexto").
- 2026-10-08: **E4 iniciada. 4a concluído (runner)**, em `apps/cli/src/chaos-run.ts`.
  - **`classifyVitestReport(json, esperadas)`** → `TestResult { hypothesisId, status, message?, durationMs }`, pelo par controle × caos (o `describe` é o id da hipótese). Arquivo que não carregou vira `invalid` e o id sai do nome do arquivo (`specFileName`). Hipótese com teste gerado que não aparece no JSON também vira `invalid` ("não rodou"), para nunca sumir do relatório. A duração é a do teste de caos.
  - **Mensagem limpa:** só a 1ª linha, sem `AssertionError:` e sem o `: expected ...` do Chai (`stateCheck: stockNeverNegative`, `statusIn: a rota não respondeu em 10007 ms`). É texto de saída de teste, não código, então aqui pode regex.
  - **Decisão: sem `npx`.** O runner chama `node <alvo>/node_modules/vitest/vitest.mjs run --config .shieldepy/chaos-tests/vitest.config.ts --reporter=json --outputFile=<tmp>`. No Windows, o `npx` é um `.cmd`, que o Node 22 só executa com `shell: true`, e o caminho tem acento e espaço. Sem Vitest instalado no alvo, ou se ele sair sem gerar o JSON, é `ChaosRunError` (vai virar exit 2 na 4b), com o fim da saída do processo para diagnóstico. O JSON fica num diretório temporário, apagado no fim.
  - **Testes:** fixture com o JSON real medido no `checkout-express` (encurtado), mais um controle que falhou e um arquivo que não carregou; processo injetado. E um teste de verdade, na CLI: gera offline e roda o Vitest dos dois exemplos. Vulnerável: 4 `failed`; corrigido: 3 `passed`; nenhum `invalid` (~17 s + ~6 s). Pulado sem o `npm install` nos exemplos.
  - **Corrida entre arquivos de teste corrigida:** o teste de compilação do agent (3e) e os testes da CLI gravavam e apagavam o mesmo `examples/*/.shieldepy/chaos-tests` em processos paralelos. Com o Vitest rodando ali por ~20 s, um apagaria os arquivos do outro. O de compilação agora usa `.shieldepy/tsc-check/` (mesma profundidade, então os `../../` gerados valem), e a CLI apaga só `chaos-tests`.
  - O comando `chaos` ainda exige `--no-run`: ligar o runner ao comando entra com o gate (4b), para não existir um "rodou e saiu 0" sem portão.
  - Suíte: **274 testes**.
- 2026-10-08: **4b concluído (portão).**
  - **Severidade** (`agent/src/chaos/results.ts`, `chaosSeverity`), sempre do motor e nunca da IA:
    - **Crítico:** `race_condition` e `partial_failure`, e qualquer achado que corrompa o estado (`stateCheck`, `maxSuccesses`), mesmo vindo de uma falha de rede (ex.: pedido gravado sem cobrança);
    - **Alto:** a rota fica pendurada ou a falha vira 500 (`respondsWithin`, "não respondeu", `noUnhandledError`);
    - **Médio:** a rota responde, mas com um status fora do esperado.
  - `TestResult` passou para o `@shieldepy/agent/chaos` (o relatório da 4c também usa), com `chaosOutcomes` (resultado + hipótese + severidade, mais grave primeiro) e `gateHits`.
  - **Comando:** `shieldepy chaos <pasta>` agora gera **e roda** (`--no-run` só gera). Saídas:
    - **exit 1:** achado com severidade `--fail-on` ou pior. **Decisão:** sem `--fail-on`, qualquer achado bloqueia (é o que a aceitação pede: `chaos --offline` → exit 1);
    - **exit 2:** o Vitest não rodou (`ChaosRunError`) ou **todos** os testes saíram inválidos. **Decisão:** inválido sozinho não bloqueia, mas se nada foi provado o CI não pode ficar verde em silêncio;
    - **exit 0:** o resto, inclusive achados abaixo do `--fail-on`.
  - O texto mostra cada resultado (`✖ Crítico race_condition POST /checkout stock`, a mensagem, o tempo, e "não conta:" nos inválidos). O `--json` ganha `results`, `gate { failOn, hits }` e `runError`.
  - **Dois bugs achados no caminho:**
    - **Varredura de pastas:** o `scanDir` dos extratores e o `listSourceFiles` usavam `readdir` recursivo e só filtravam `node_modules`/`.shieldepy` depois. Isso é lento num projeto real (o CI sempre tem `node_modules`) e quebrava com ENOENT quando outro processo apagava `.shieldepy/` no meio da varredura. Agora os dois usam `walkSourceTree` (core), que nem entra nas pastas ignoradas.
    - **O mapa dependia da ordem de indexação.** Com a nova varredura (ordenada), o `GET /orders/:id` perdeu a aresta para `CheckoutService.find`. O motivo: `container.ts` exporta `new CheckoutService()`, e quando o `CheckoutService.ts` chegava depois, a religação subia até o `container.ts`, mas não até quem importa o container. Agora `forwardsImports` também vale para instância exportada (`valueTypes`) e objeto exportado com referências (`objectRefs`). Há um teste que indexa o exemplo em três ordens e exige o mesmo hash; sem a correção, ele falha.
  - A aceitação de verdade (comando completo, Vitest real) já está na CLI: o vulnerável sai com **exit 1** e 4 achados, e o corrigido com **exit 0** e 3 aprovados.
  - Suíte: **282 testes**.
- 2026-10-08: **4c concluído (relatório markdown)**, em `agent/src/chaos/report.ts`.
  - **`renderChaosReport`**, determinístico. Começa com a marca `<!-- shieldepy-chaos -->` (o workflow edita o último comentário) e traz:
    - uma linha de status: bloqueado, passou, passou no portão com achados abaixo dele, nada provado (todos inválidos), erro de ambiente ou `--no-run`;
    - a contagem (achados, aguentou, inválidos, sem teste);
    - a tabela de achados: severidade, rota, falha injetada, alvo, invariante violada e tempo;
    - para cada achado, um `<details>` com o porquê da hipótese, as operações da rota em ordem com `arquivo:linha` (as do alvo em negrito, "← alvo da falha") e o arquivo do teste;
    - as listas "aguentou", "inválidos (não contam no portão)" e "sem teste no MVP (não bloqueiam)";
    - um rodapé com o motor das hipóteses, o custo da IA e o `topologyHash`.
  - **Parágrafo:** `explainChaosOutcomes` só chama a IA com provider **e** achado. Usa o tier `fast` e manda só fatos: achados, invariante e operações com `arquivo:linha`, sem código. A resposta é `{"paragraph"}`, validada (vazia ou com bloco de código é descartada). Sem IA, ou se falhar, sai um parágrafo do motor ("requisições simultâneas em POST /checkout corrompem stock (stateCheck: stockNeverNegative); ..."). A chamada entra no custo mesmo quando é descartada.
  - **CLI:** `--report <arquivo.md>`. O relatório é gravado também quando o ambiente falhou, para o resumo do CI dizer por quê.
  - Conferido no `checkout-express` de verdade (exit 1, 4 achados, 2 hipóteses `partial_failure` sem teste). As operações saem como lista (`- `); sem isso, o GitHub juntava as linhas num parágrafo só.
  - Suíte: **288 testes**.
- 2026-10-08: **4d concluído (GitHub Actions + template).**
  - **`.github/workflows/shieldepy-chaos.yml`** (raiz do repositório). Roda em PR e push na `main` que toquem `shieldepy_p1/**`, e à mão. Usa Node 22, cache do npm e `npm ci` no ShielDepy e no alvo.
  - **Decisão, por causa do exemplo vulnerável:** o `checkout-express` quebra de propósito, então usá-lo como portão deixaria todo PR vermelho. Por isso há uma matriz com dois papéis:
    - **`chaos-gate`:** roda no `checkout-express-fixed` com `--fail-on Alto`, publica o relatório no `$GITHUB_STEP_SUMMARY` e comenta no PR (`gh pr comment --edit-last || gh pr comment`, com `continue-on-error`, porque PR de fork não tem permissão de escrita). **É o portão:** um PR que reintroduza a corrida ou tire o timeout do Stripe no corrigido fica vermelho. É assim que se faz o "PR de teste com check vermelho" da 4e;
    - **`self-test`:** o vulnerável **tem** que sair com 1, e o relatório tem que trazer a corrida em `stock` e o timeout do Stripe. Se o detector ficar cego, o CI fica vermelho.
  - **Job `check`:** `npm run check` com os dois exemplos instalados. É o que faz rodar no CI os testes que localmente são pulados sem `npm install` (a compilação da 3e e o Vitest de verdade da 4a/4b), como pedia a pendência 1.
  - **IA:** com o secret `ANTHROPIC_API_KEY`, usa a IA; sem ele, `--offline`. **Não configurei secret nenhum**: ligar a IA paga no CI é decisão do usuário.
  - O código de saída do `shieldepy` é capturado (`node apps/cli/bin/shieldepy.js`, sem `npm run`, que pode trocar o código). O relatório é publicado antes, e só no fim o passo "Portão" sai com esse código, com `::error::` dizendo se foi achado (1) ou ambiente (2).
  - **Simulado localmente** com o mesmo bash dos passos: no `chaos-gate`, o corrigido sai 0; no `self-test`, o vulnerável sai 1, com a corrida e o timeout encontrados no relatório. O YAML foi validado com `js-yaml`, e os lockfiles têm os binários de Linux (rollup/esbuild). **Não rodou no GitHub:** isso depende do push.
  - **Template para repositórios-alvo:** `shieldepy_p1/docs/shieldepy-chaos.template.yml`, com o guia `docs/chaos-ci.md` (contrato, dependências, `env` do topo, códigos de saída, severidade, IA e custo, limites). Como o ShielDepy não está no npm, o template faz o checkout dele e o **move para `$RUNNER_TEMP`**: com `APP_DIR: .`, ele ficaria dentro do app e entraria no mapa.
  - README: execução, portão, `--report`, o workflow e os arquivos novos no mapa do código.
- 2026-10-08: **4e concluído (aceitação), e com ele a E4.**
  - **`shieldepy chaos examples/checkout-express --offline` → exit 1**, com 4 achados: `race_condition stock` (Crítico, `stateCheck: stockNeverNegative`), `timeout api.stripe.com` (Alto, 6 s sem resposta), e `http_5xx` e `malformed_response` (Alto, a rota fica pendurada). O relatório aponta a corrida e o timeout com as operações e o `arquivo:linha`.
  - **O mesmo no `checkout-express-fixed` → exit 0**, com 3 testes aguentando. Os dois casos estão fixados na suíte (Vitest de verdade, pulados sem `npm install` nos exemplos) e no job `self-test` do CI.
  - **PR de teste, simulado localmente:** tirar o `signal: AbortSignal.timeout(...)` do `StripeGateway` do `-fixed` faz o motor ver `no-timeout` e gerar a hipótese de timeout. O teste quebra (`respondsWithin`, 6 s), e `--fail-on Alto` sai com **exit 1** e o relatório "Bloqueado: 1 achado". O arquivo foi restaurado.
  - **Roteiro do PR de teste no GitHub (falta fazer, depende do push):** depois do merge da E4, criar uma branch a partir da `main` que só remova a linha `signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),` de `shieldepy_p1/examples/checkout-express-fixed/src/gateways/StripeGateway.ts` e abrir o PR. Esperado: o job `chaos-gate` vermelho ("o código quebra sob falha injetada"), o `self-test` e o `check` verdes, e um comentário no PR com o relatório (tabela com `🟠 Alto` · `timeout` · `api.stripe.com`). Depois, fechar o PR sem merge.
  - **Mensagem do portão:** sem `--fail-on`, diz só "N achado(s) de caos", em vez de "severidade Baixo ou pior". O relatório faz igual.
  - **Conferido no fim:** typecheck limpo, **288 testes**, **E2E 24/24** num VS Code real (o core mudou na 4b: varredura e religação), extensão com **612 KB** (o caos continua fora do bundle).
  - **Estado final da E4:** pronta para o usuário subir a branch `feat/chaos-gate` e fazer o merge.
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
- **2d. Topologia** (`topology/build.ts` + `types.ts`): ✅ Concluída em 2026-10-08.
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
- **2e. Superfície de ataque + CLI.** ✅ Concluída em 2026-10-08.
  - `attackSurface(topology)`: só rotas com I/O e baldes com colisão. É isto, e não o código, que vai para a IA.
  - `shieldepy topology <pasta> [--json] [--out .shieldepy/topology-graph.json]`.
  - O `--html` do V1 mostra rotas e operações como nós.
- **2f. Extensão (pequeno).** ✅ Concluída em 2026-10-08. Comando "ShielDepy: Exportar topologia" usando o `WorkspaceModel` (grafo + regras já em memória).

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

## Custo estimado da IA (E3), preços conferidos em 2026-10-08

**Agentes LLM no pipeline:**
- **MVP:** 3 nós com IA. O **Threat Modeler** (tier `deep`) e os especialistas **Network** e **Concurrency** (tier `fast`; só preenchem specs estruturadas).
- **Depois:** **DB_Chaos** (4º) e o parágrafo opcional do relatório (5º).
- **Sem IA:** escrever, rodar e gerar o relatório determinístico.
- **Modo `--offline`:** custo zero.

Preços da Claude API (Anthropic, 1ª parte), conferidos na referência oficial em 2026-10-08. A mesma tabela está no código, em `packages/agent/src/cost.ts`.

| Modelo | ID | Entrada / 1M | Saída / 1M | Leitura de cache / 1M |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | US$ 4,00 | US$ 20,00 | US$ 0,20 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | US$ 2,00 | US$ 10,00 | US$ 0,20 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | US$ 1,00 | US$ 5,00 | US$ 0,10 |

A escrita de cache custa 1,25× a entrada (TTL de 5 min). O prefixo mínimo cacheável é de 512 tokens no Opus/Sonnet 5.5 e de 4096 no Haiku 4.5.

> Correção de 2026-10-08: a versão anterior desta tabela tinha uma linha "Claude Haiku 5.5" a US$ 0,10 / 0,50. Esse modelo não existe, e o Haiku atual (4.5) custa **10× isso**. As estimativas abaixo foram recalculadas.

**Estimativa por execução.** O raciocínio (thinking) é cobrado como saída. São ordens de grandeza, que a E3 mede de verdade com o `CostMeter`. Câmbio assumido: R$ 5,50 por dólar. Na coluna "Misto", a suposição é que o Threat Modeler usa metade dos tokens, no Opus, e os especialistas a outra metade, no Haiku.

| Superfície de ataque | Tokens (entrada / saída) | Opus 5.5 | Sonnet 5.5 | Haiku 4.5 | Misto (Threat Modeler Opus + especialistas Haiku) |
|---|---|---|---|---|---|
| Pequena (~2 rotas, ex.: `checkout-express`) | ~8k / ~6k | ~R$ 0,84 | ~R$ 0,42 | ~R$ 0,21 | ~R$ 0,52 |
| Média (~20 rotas sensíveis) | ~30k / ~25k | ~R$ 3,41 | ~R$ 1,71 | ~R$ 0,85 | ~R$ 2,13 |
| Grande (~100 rotas sensíveis) | ~120k / ~80k | ~R$ 11,44 | ~R$ 5,72 | ~R$ 2,86 | ~R$ 7,15 |

**Alavancas de custo, previstas para a E3:**
1. **Rodar só para as rotas cuja cadeia o PR tocou** (diff de hash do mapa). A maioria dos PRs fica com custo zero.
2. **Cache de prompt** no prompt de sistema e no catálogo, que são estáveis.
3. **Especialistas no tier `fast`**, porque só preenchem specs validadas.
4. **Registrar o custo de cada execução no relatório do PR.**

## E3 — contexto sobre o que a E2 entregou (escrito em 2026-10-08, antes de começar)

> As seções "Fase 2" e "Fase 3", abaixo, continuam valendo como desenho. Esta seção diz **de onde a E3 parte**, o que precisa ser preparado antes e em que ordem fazer. Branch: `feat/chaos-agentes`, criada a partir da `main` depois do merge da E2.

### Decisões da E2 que a E3 herda (já tomadas; não precisam de resposta)
1. **Transação sem `FOR UPDATE`:** a rota perde a tag `no-transaction`, mas mantém `read-then-write`. No READ COMMITTED do Postgres a corrida ainda existe; o teste de concorrência da E3 é quem confirma ou descarta.
2. **Middleware de pacote ou de chamada** (`express.json()`) aparece na cadeia de handlers como `opaque`: está lá, mas o percurso não entra nele.
3. **API do core** saiu como `args` + `callSitesIn` + `origin`, no lugar de `firstArg`/`referencesAt` (ver o registro da 2a).

### O que a E2 entrega e a E3 reaproveita

| Peça da E2 | Uso na E3 |
|---|---|
| **`attackSurface(topology)`** (`core/src/topology/surface.ts`): rotas sensíveis com operações em ordem, `at: arquivo:linha`, `in: função`, tags e colisões, **sem código** | É a **única entrada** do Threat Modeler. O `topologyHash` vai junto e volta no relatório: a resposta da IA fica amarrada a um mapa. |
| **`SurfaceRoute.id`** (`POST /checkout`) | É o `routeId` de cada hipótese. A validação descarta qualquer `routeId` que não esteja na superfície. |
| **Tags de sensibilidade** | Habilitam as falhas do catálogo (tabela abaixo). A validação descarta a falha que a rota não habilita. |
| **`IoOperation.target` e `timeout`** (`api.stripe.com`, `no`) | O especialista de rede sabe qual host interceptar com o MSW (`http.all('https://api.stripe.com/*')`) sem ler código. |
| **`confidence` e `truncated`** | Hipótese sobre operação `heuristic`, ou rota truncada, sai marcada assim no relatório. |
| **Modo offline** | Sem chave de API, as hipóteses saem direto das tags (é o `offline.ts` da Fase 2). |
| **`parseRules`** (`core/src/interactions/validate.ts`) | Padrão para validar a saída da IA: lança com a posição e o campo inválido. |
| **`LLMProvider`** (`agent/src/provider.ts`) | Os nós do LangGraph chamam `complete({ tier, json: true })`. Sem chat models do LangChain. |

### Catálogo × tags (o que cada falha precisa para ser proposta)

| Falha | Habilitada por | Especialista | Invariante típico no `checkout-express` |
|---|---|---|---|
| `timeout` | `api_call` com `timeout: no` ou `unknown` | Network | `respondsWithin(ms)`: o cliente não pode ficar pendurado |
| `http_5xx_intermittent` | `external-io` | Network | `statusIn([502, 503])` e nenhum pedido gravado |
| `malformed_response` | `external-io` | Network | `statusIn([502])` e `noUnhandledRejection` |
| `race_condition` | `read-then-write` ou `multi-write-same-target` | Concurrency | `stateCheck('stockNeverNegative')` e `maxSuccesses(1)` com estoque 1 |
| `retry_storm` | `external-io` | Network | Fica fora do MVP: o exemplo não tem retry. |
| `partial_failure_after_external_call` | `write-after-api-call` | **DB_Chaos** (depois) | Exige falhar o **banco** depois da cobrança. No MVP, o Threat Modeler pode apontar a falha, mas ela vai para o relatório como hipótese sem teste. |

### Pendências encontradas no código (têm que entrar na E3)
1. **O exemplo não executa.** O `checkout-express` só tem código-fonte: sem `node_modules`, sem banco e sem testes. O `db.ts` cria um `Pool` real no import. Para um teste de caos rodar, ele precisa de:
   - `createApp` aceitando as dependências (o `pool` injetável), para os testes usarem **`pg-mem`**;
   - um schema com seed (`stock`, `orders`);
   - o `shieldepy.chaos.config.ts` (`createApp`, `reset`, `invariants.stockNeverNegative`);
   - as dependências de teste: `vitest`, `supertest` e `msw`.

   A mudança tem que **manter a topologia igual**: os testes da E2 conferem a sequência exata de operações.
2. **Falta a variante `checkout-express-fixed`** (com `SELECT ... FOR UPDATE` dentro de transação e `AbortSignal.timeout`). Ela também serve de teste da E2: a topologia dela **não pode** ter `no-transaction` nem `no-timeout`.
3. **O `LLMProvider` devolve só texto.** A alavanca de custo nº 4 ("registrar o custo de cada execução") precisa dos tokens de entrada e saída. O provider tem que devolver o `usage` (Anthropic e Gemini) sem quebrar quem já usa `complete`.
4. **Modelos padrão:** hoje `fast` e `deep` usam `claude-haiku-4-5` (`DEFAULT_ANTHROPIC_MODELS`). O Threat Modeler é tier `deep`; definir o padrão (configurável por `SHIELDEPY_DEEP_MODEL`) quando o custo for medido.
5. **Tabela de custo:** a linha "Claude Haiku 5.5" não corresponde a um modelo existente; o Haiku atual é o **Haiku 4.5**. Os preços da tabela precisam ser conferidos na hora de medir (tarefa 3b).
6. **Dependências novas:** `@langchain/langgraph` e `@langchain/core` no `packages/agent`; `supertest`, `msw` e `pg-mem` só no exemplo (o ShielDepy gera o teste; quem roda é o projeto-alvo).

### Tarefas da E3

- **3a. Exemplo executável e variante corrigida.** ✅ Concluída em 2026-10-08 (PGlite no lugar do `pg-mem`; a corrigida reserva antes de cobrar; config com `requests`; ver o registro).
  - `checkout-express` com o `pool` injetável, `pg-mem`, seed e `shieldepy.chaos.config.ts`.
  - `checkout-express-fixed` com lock + transação + timeout.
  - Teste da E2: a topologia do vulnerável continua igual, e a do corrigido perde `no-transaction` e `no-timeout`.
  - Um teste manual de cada (supertest), para provar que o app sobe em memória.
- **3b. Provider com `usage`** e custo por execução (tokens → R$ pela tabela, conferida). ✅ Concluída em 2026-10-08.
- **3c. Estado, catálogo e Threat Modeler** (`agent/src/chaos/`): ✅ Concluída em 2026-10-08.
  - `state.ts` (LangGraph `Annotation.Root`), `catalog.ts` (a tabela acima, como dados);
  - `nodes/threat-modeler.ts` com entrada = `attackSurface` serializada;
  - `validate-hypotheses.ts`: rota existe, falha no catálogo e habilitada pelas tags; o resto é descartado e contado;
  - `offline.ts`: hipóteses direto das tags.
- **3d. Especialistas Network e Concurrency** ✅ Concluída em 2026-10-08. Preenchendo `NetworkSpec`/`ConcurrencySpec` (só parâmetros e invariantes, validados), com fan-out por `Send`.
- **3e. Templates e escrita.** ✅ Concluída em 2026-10-08.
  - `templates/network.ts` e `templates/concurrency.ts` → `.shieldepy/chaos-tests/<rota>__<falha>.spec.ts` e o `vitest.config.ts` gerado.
  - Cada spec já sai com o bloco **`control`** (a mesma requisição, sem caos), que a E4 usa contra falso positivo.
  - `ChaosIo { write(files) }` injetado; o teste confere que o gerado compila (`tsc --noEmit`) contra o exemplo.
- **3f. CLI:** ✅ Concluída em 2026-10-08. `shieldepy chaos <pasta> --no-run [--offline]` gera os testes e um relatório de hipóteses (com custo e `topologyHash`). **Rodar e bloquear o PR é a E4.**

### Aceitação da E3 (no `checkout-express`)
- **Offline:** gera ao menos `POST /checkout__race_condition.spec.ts` e `POST /checkout__timeout.spec.ts`. Os dois compilam contra o exemplo e têm o bloco de controle.
- **Com chave:** as hipóteses da IA passam pela mesma validação. Uma resposta com rota inexistente ou falha fora do catálogo é descartada, e o descarte aparece no relatório.
- **`GET /orders/:id`** (só leitura, sem tags) **não** gera teste de corrida nem de rede.
- O relatório traz o custo da execução e o `topologyHash`.

## E4 — contexto sobre o que a E3 entregou (escrito em 2026-10-08, antes de começar)

> A seção "Fase 4", abaixo, continua valendo como desenho. Esta seção diz **de onde a E4 parte**. Branch: `feat/chaos-gate`, criada a partir da `main` depois do merge da E3.

### Decisões da E3 que a E4 herda (já tomadas; não precisam de resposta)
1. **Contrato do projeto:** `shieldepy.chaos.config.ts` com `{ createApp, setupFiles, reset, invariants, apis, requests }`. Ele é lido pela AST (só nomes) e executado só dentro dos testes gerados.
2. **Banco dos testes do exemplo:** PGlite (Postgres em WASM), não `pg-mem` (bug com `UPDATE` parametrizado repetido).
3. **A variante corrigida reserva o estoque antes de cobrar** (UPDATE atômico + compensação), em vez de `FOR UPDATE`.
4. **A IA não tira hipótese da lista-base do motor**; ela explica, prioriza e acrescenta.

### O que a E3 entrega e a E4 reaproveita

| Peça da E3 | Uso na E4 |
|---|---|
| `shieldepy chaos <pasta> --no-run` | A E4 tira a exigência do `--no-run`: o padrão passa a ser gerar **e rodar**. |
| `.shieldepy/chaos-tests/*.spec.ts` + `vitest.config.ts` gerado | `run.ts` chama `npx vitest run --config .shieldepy/chaos-tests/vitest.config.ts --reporter=json` no diretório do projeto. |
| Cada arquivo tem `CONTROL_TEST_NAME` + o teste de caos | **Classificação:** controle falhou → `invalid` (ambiente ou teste ruim, **não bloqueia**); controle passou e caos falhou → `failed` (achado); os dois passaram → `passed`. O nome do teste vem no JSON do reporter. |
| Mensagens das asserções (`stateCheck: stockNeverNegative`, `a rota não respondeu em X ms`) | Vão direto para o relatório do PR, como "invariante violada". |
| `Hypothesis.priority`, `failure` e `SurfaceOperation.at` | Severidade do gate e o `arquivo:linha` das operações no relatório. |
| `CostMeter` / `topologyHash` | Linha de custo e rastreabilidade no comentário do PR. |

### Já medido na E3 (a aceitação da E4 parte daqui)
- **`checkout-express`:** 4 controles passam e **4 testes de caos falham**: corrida (`stockNeverNegative`), timeout (6 s), 5xx e corpo inválido (a rota fica pendurada; achado real, ver o registro da 3e). Leva ~15 s.
- **`checkout-express-fixed`:** **3/3 passam** (~5 s).

### Pendências encontradas (têm que entrar na E4)
1. **O CI precisa instalar o projeto-alvo** (`npm ci` dentro do exemplo) antes de rodar. Sem isso, os testes gerados nem compilam. O teste de compilação da 3e é pulado quando falta o `node_modules`; no CI ele precisa rodar.
2. **Severidade do gate:**
   - `race_condition` e `partial_failure` → Crítico;
   - `timeout` sem resposta e `http_5xx`/`malformed` que viram 500 ou deixam a rota pendurada → Alto.
   - O `--fail-on` reaproveita `severityRank` da CLI.
3. **Tempo:** o teste de timeout espera a paciência inteira (6 s) e os de rede pendurados, 10 s. No CI, rodar os arquivos em paralelo (padrão do Vitest) e manter o `testTimeout` gerado.
4. **Relatório markdown** (`--report chaos-report.md`) para o `$GITHUB_STEP_SUMMARY` e o comentário do PR: rota, falha injetada, invariante violada, `arquivo:linha` das operações, custo e `topologyHash`. Parágrafo opcional da IA (com fallback offline), no estilo de `explainCollisions`.
5. **Hipóteses sem teste** (`partial_failure`, `retry_storm`) aparecem no relatório como "não testadas no MVP", **sem** bloquear.

### Formato do resultado (medido em 2026-10-08 nos testes gerados do `checkout-express`)

`npx vitest run --config .shieldepy/chaos-tests/vitest.config.ts --reporter=json --outputFile=<arquivo>` (no diretório do projeto) sai com **exit 1** quando algum teste falha. O JSON tem:
- no topo: `success`, `numFailedTests`, `numPassedTests` e `testResults[]`;
- por arquivo (`testResults[i]`): `name` (caminho), `status` e `message` (erro de carga do arquivo, ex.: não compilou) e `assertionResults[]`;
- por teste (`assertionResults[j]`): `ancestorTitles[0]` = **id da hipótese** (o `describe` do template), `title` = `CONTROL_TEST_NAME` ou `caos: ...`, `status` (`passed`/`failed`), `failureMessages[0]` (a 1ª linha é a mensagem da asserção, ex.: `AssertionError: stateCheck: stockNeverNegative: ...`) e `duration`.

Classificação por hipótese:
- **controle falhou** → `invalid`;
- **controle passou e caos falhou** → `failed`, com a mensagem limpa (sem o `AssertionError:` e sem o `expected ...`);
- **os dois passaram** → `passed`;
- **arquivo não carregou** (sem `assertionResults`, com `message`) → `invalid` com a mensagem.

Medido no vulnerável:

| hipótese | controle | caos | mensagem | duração do caos |
|---|---|---|---|---|
| `race_condition__stock` | passed | failed | `stateCheck: stockNeverNegative` | ~0,2 s |
| `timeout__api.stripe.com` | passed | failed | `respondsWithin: o cliente ficou mais de 6000 ms sem resposta` | ~6 s |
| `http_5xx_intermittent__api.stripe.com` | passed | failed | `statusIn: a rota não respondeu em ~10000 ms` | ~10 s |
| `malformed_response__api.stripe.com` | passed | failed | `statusIn: a rota não respondeu em ~10000 ms` | ~10 s |

### Tarefas da E4
- **4a. Runner** ✅ Concluída em 2026-10-08 (Vitest do alvo chamado pelo `node`, sem `npx`; ver o registro). (`apps/cli/src/chaos-run.ts`; a CLI já tem `apps/cli/src/chaos.ts`, então nada de pasta `chaos/` com o mesmo nome): `spawn` do Vitest com o reporter JSON e `--outputFile` num arquivo temporário (não o stdout, que mistura logs do app), parse e `TestResult { hypothesisId, status: passed|failed|invalid, message, durationMs }`, com a classificação acima. O processo é injetado para testar sem rodar o Vitest; o teste usa um JSON de exemplo no formato medido.
- **4b. Gate:** ✅ Concluída em 2026-10-08 (sem `--fail-on`, qualquer achado bloqueia; todos inválidos = exit 2; ver o registro). severidade por falha, `--fail-on`, exit 1 com achado válido e exit 2 com erro de ambiente.
- **4c. Relatório markdown** ✅ Concluída em 2026-10-08 (`--report`; ver o registro). (determinístico + parágrafo opcional da IA).
- **4d. GitHub Actions** ✅ Concluída em 2026-10-08 (portão no exemplo corrigido + self-test no vulnerável + job de testes; ver o registro). (`.github/workflows/shieldepy-chaos.yml`): Node 22, `npm ci` no ShielDepy e no alvo, `shieldepy chaos --report --fail-on Alto`, `$GITHUB_STEP_SUMMARY` e comentário no PR (`gh pr comment --edit-last || gh pr comment`), `ANTHROPIC_API_KEY` por secret e `--offline` sem ela. Também um template em `docs/` para repositórios-alvo.
- **4e. Aceitação:** ✅ Concluída em 2026-10-08 nos dois primeiros itens. O terceiro depende do push (roteiro no registro).
  - `shieldepy chaos examples/checkout-express --offline` → exit 1, com o relatório apontando a corrida e o timeout;
  - o mesmo em `checkout-express-fixed` → exit 0;
  - um PR de teste no GitHub com check vermelho e comentário.

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
`shieldepy_p1/examples/checkout-express/`: `POST /checkout` que faz `SELECT stock` (pg; nos testes, PGlite em memória) → `fetch('https://api.stripe.com/v1/charges')` → `UPDATE stock`/`INSERT orders` **sem lock** (race proposital) e sem timeout no fetch. Inclui `shieldepy.chaos.config.ts` com os invariantes `stockNeverNegative` e `atMostOneOrder` e as requisições válidas. A variante `checkout-express-fixed` (reserva atômica antes de cobrar, com compensação, e `AbortSignal.timeout`) deve passar. *(Atualizado na 3a: PGlite no lugar do `pg-mem`, e reserva atômica no lugar de `FOR UPDATE`.)*

## Arquivos críticos
- Já existem (E2/E3): `packages/core/src/topology/*`, `packages/core/src/sql/*`, `packages/core/src/chaos-config.ts`, `packages/agent/src/chaos/*`, `packages/agent/src/cost.ts`, `apps/cli/src/chaos.ts`, `examples/checkout-express*`.
- Novos na E4: `apps/cli/src/chaos-run.ts` (runner), o relatório markdown, `.github/workflows/shieldepy-chaos.yml` e o template em `docs/`.
- Alterar: [main.ts](shieldepy_p1/apps/cli/src/main.ts) (comandos `topology`/`chaos`, USAGE), `packages/core/src/index.ts`, `packages/agent/src/index.ts`, `packages/agent/package.json`, [WorkspaceModel.ts](shieldepy_p1/apps/vscode/src/workspace/WorkspaceModel.ts) (registrar extratores no `onParsed`) + comando de export na extensão, `shieldepy_p1/README.md` (seção nova + limites).
- Reusar: `CodeGraph.onParsed`, `getEnclosingSymbol`, `indexFiles`/`listSourceFiles`, `buildGraph`/`findCollisions`, `parseRules` (padrão de validação), `providerFromEnv`, `severityRank`, `gate()` da CLI.

## Verificação
0. **Gate do marco 1 (grafo):**
   - `shieldepy graph examples/checkout-express --json` mostra `callsUnresolved = 0` (atingido no 1c, com `callsHeuristic = 0`).
   - A rota mostra a cadeia completa handler → service → repo → `pg` e `fetch`.
   - Os testes das fixtures da Fase 0 passam.
   - Só depois disso começa a Fase 2.
1. `npm test` — testes Vitest novos:
   - `core/test/topology/*`: extratores de rota/I/O sobre fixtures inline (fetch, axios, pg SQL, prisma), BFS por chamadas, tags, filtro, hash estável (duas execuções = mesmo JSON). ✅ E2: `routes.test.ts`, `io.test.ts` e `build.test.ts`.
   - `agent/test/chaos/*`: validação de hipóteses (descarta rota inexistente/falha fora do catálogo), templates geram código que compila (`tsc --noEmit` em snapshot), grafo LangGraph com `LLMProvider` fake e `ChaosIo` fake percorre todos os estados. ✅ E3: `threat-modeler.test.ts`, `specialists.test.ts` e `templates.test.ts` (que compila contra os exemplos de verdade).
   - `cli/test`: `topology` em `examples/checkout-express` gera `POST /checkout` com `db_read→api_call→db_write` e tags `read-then-write`, `write-after-api-call`. ✅ E2.
2. `npm run typecheck`.
3. E2E manual: `npm run cli -- chaos examples/checkout-express --offline` → exit 1, relatório aponta race (estoque negativo) e timeout no Stripe; mesmo comando em `checkout-express-fixed` → exit 0. ✅ E4 (também coberto pela suíte). Repetir com `ANTHROPIC_API_KEY`: pendente, porque é uma chamada paga.
4. Abrir PR de teste no GitHub com o exemplo vulnerável e confirmar check vermelho + comentário no PR. Pendente (depende do push). Roteiro no registro da 4e: o PR tira o timeout do `checkout-express-fixed`.
