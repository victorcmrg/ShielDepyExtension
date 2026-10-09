# Plano — Chaos Engineering dirigida por Análise Estática (fatia vertical)

## Contexto
Hoje o ShielDepy só prova **colisões entre handlers de evento** (`Rule` → buckets `resource::event`) e **ciclos de chamada** (CodeGraph via Tree-sitter). Não há detecção de rotas HTTP nem de I/O (DB/API), não há export do grafo, não há LangGraph e não há `.github/`. O objetivo é o motor determinístico apontar as rotas sensíveis (`topology-graph.json`), um pipeline LangGraph gerar testes de caos **apenas** para essas rotas, executá-los com Vitest e bloquear o PR quando o código quebra sob falha física.

Decisões tomadas: **LangGraph.js em TS** (dentro de `packages/agent`, sobre o `LLMProvider` existente), alvo **Express + fetch/axios + pg/Prisma**, runner **Vitest** (+ supertest + MSW), entrega **ponta a ponta com `Network_Chaos_Agent` e `Concurrency_Agent`**; `DB_Chaos_Agent` fica para depois.

Princípio mantido do projeto: *o motor prova, a IA propõe*. Toda saída da IA é validada; sem chave de API existe caminho offline determinístico; um teste só conta como falha se passar no **run de controle** (sem caos).

**Ordem de entrega (ajuste pedido):** primeiro aperfeiçoar o mapeamento do sistema em grafos (Fase 0 + Fase 1), com métrica de cobertura e testes. Só depois disso, e com o grafo validado nos exemplos, entram os agentes (Fases 2–4). Cada marco é um PR separado.

## Como retomar num chat novo (atualizado em 2026-10-09, início da etapa R)

**Onde estamos:** E1–E5, V1–V3 estão **todas mergeadas na `main`** (`297c964`, PRs #1–#7). A etapa atual é a **R — jornada do usuário e release da extensão**, na branch `feat/jornada-release` (criada a partir da `main`). Leia, nesta ordem:
1. esta seção;
2. a seção **"R — jornada do usuário e release"** (decisões do usuário e tarefas R1–R4);
3. o fim do **Registro**, para os detalhes de cada fatia já feita.

**Decisões de 2026-10-09 (do usuário):**
- **Só JS/TS por enquanto.** Python talvez depois; Java e C# saem do roadmap (a E6 vira "Python, talvez").
- **Modo local grátis:** sem conta, a extensão faz tudo o que é determinístico (ciclos, colisões, mapa, topologia, caos offline). A conta só traz o portal, a equipe e a política de IA da empresa.
- **O portal ainda não está publicado.** O release não pode depender dele.
- **Release:** primeiro `.vsix` nas GitHub Releases; o Marketplace fica para quando estabilizar.

**Pendências antigas que continuam valendo:** o PR de teste do workflow no GitHub (o `shieldepy-chaos.yml` nunca rodou no Actions) e a medição paga da 5e.

**Combinados com o usuário (seguir sem perguntar):**
- Responder **em português**.
- Trabalhar **fatia por fatia** (4a, 4b, ...): cada uma termina com testes passando, este plano atualizado (registro + ✅ na tarefa) e **um commit** no mesmo commit da mudança. Mensagem de commit em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Gastar com a API da IA (chamada paga) só com autorização explícita do usuário**, na hora de medir (tarefa 5e).
- **Não fazer push nem abrir PR.** O usuário sobe a branch e faz o merge quando a etapa **inteira** estiver pronta. No fim, avisar e oferecer título e descrição do PR.
- Escolhas técnicas que surgirem: decidir, registrar no plano o porquê e avisar no resumo. Só perguntar o que for realmente do usuário (ex.: gastar dinheiro com chamada paga à IA, mexer no GitHub).
- **Nada de regex para ler código** (só Tree-sitter ou analisador léxico). Regex em texto da IA ou em caminho de arquivo pode.
- O princípio do projeto: **o motor prova, a IA propõe**. Toda saída da IA é validada, existe caminho offline, e um teste só conta como falha se o controle passou.

**Como rodar (de `shieldepy_p1/`):**
- `npm run check`: typecheck + testes unitários (**325** no fim da etapa R, nenhum pulado quando os exemplos têm `npm install`).
- `npm run build:vscode`: dois arquivos. `dist/extension.js` tem ~640 KB; se crescer muito, algo puxou o LangGraph para dentro dele. O `dist/chaos.js` (~1,9 MB) é o pipeline de caos, carregado só pelo "Testar Caos".
- `npm run test:e2e -w shieldepy`: E2E num VS Code real (**33/33**, leva alguns minutos). O cenário do caos de verdade só roda com `npm install` em `examples/checkout-express`.
- `npm run package:vscode`: gera o `.vsix`. Para conferir o pacote, instale-o num `--extensions-dir` temporário e rode `SHIELDEPY_E2E_EXTENSION=<pasta instalada> node apps/vscode/test-e2e/run.mjs`.
- **Portal em desenvolvimento:** a extensão vem sem portal (`shieldepy.webBaseUrl` vazio, modo local). Para testar o login com o `npm run web`, ponha `"shieldepy.webBaseUrl": "http://localhost:3000"` nas settings.
- `npm run cli -- chaos examples/checkout-express --offline [--report chaos-report.md]`: gera e roda os testes de caos e aplica o portão (exit 1 no vulnerável e 0 no `-fixed`). Com `--no-run`, só gera.
- Dentro de um exemplo (`examples/checkout-express` e `-fixed`, que precisam de `npm install` próprio): `npm test` roda o teste de fumaça. Sem esse `npm install`, os testes da CLI e do agent que rodam o Vitest e o `tsc` dos exemplos são pulados.
- Atenção no Windows: os caminhos têm acento e espaço (`Área de Trabalho`), então use sempre aspas. Os arquivos do repositório estão em CRLF, e edições por script que procuram `\n` podem não casar; prefira o editor.

**Ainda não feito, de propósito (não é bug):**
- Os modelos padrão (`fast` e `deep` = Haiku 4.5) não mudaram, porque falta medir com chamada paga.
- `partial_failure` e `retry_storm` não têm teste (aparecem no relatório como "sem teste no MVP", sem bloquear).
- O workflow da E4 nunca rodou no GitHub (depende do push), e nenhum secret `ANTHROPIC_API_KEY` foi configurado: no CI ele roda `--offline` até o usuário decidir pagar pela IA.
- As observações do registro da 3a: 5 heurísticas e 2 sem alvo no `packages/` do próprio ShielDepy. (O `graph apps` lento foi resolvido na V2e: o `.vscode-test` agora é ignorado.)

## Progresso e fluxo de trabalho

Este arquivo é atualizado a cada tarefa concluída, no mesmo commit da mudança. Cada etapa tem sua branch. **O merge na `main` é feito pelo usuário** quando a etapa inteira estiver completa.

- **E1 — Mapeamento em grafos** (tarefas 1a–1d, branch `feat/chaos-grafo`): pré-requisito de tudo. O grafo precisa ser completo e confiável antes de qualquer agente. **Completa em 2026-10-07, mergeada na `main` (PR #1).**
- **E2 — Topologia** (tarefas 2a–2f, ver a seção "Fase 1 / E2"), **E3 — Agentes** (tarefa 3), **E4 — Gate de CI** (tarefa 4).
- **Merges feitos:** `feat/chaos-grafo` (E1, PR #1) → `feat/grafo-visualizador` (V1, PR #2).
- **E2 completa e mergeada** (PR #3, `b4eeb7b`).
- **E3 completa e mergeada** (PR #4, `ccc11c2`).
- **E4 completa** na branch `feat/chaos-gate` (criada a partir da `main`, `ccc11c2`): 4a–4e. Enviada pelo usuário; falta o merge e o PR de teste no GitHub.
- **Reordenação de 2026-10-08 (decidida com o usuário):** a antiga E5 (outras linguagens) virou **E6**. A **E5** passou a ser o **mapa incremental e o custo**: ids estáveis, diff entre o mapa do PR e o da `main`, caos só nas rotas que o PR tocou e medição do custo real da IA. Motivo: é a maior alavanca de custo e de tempo de CI, e o diff entre mapas também é pré-requisito do V2. Ver a seção "E5".
- **V3 completo** na branch `feat/portal-v3` (V3a–V3e), empilhada sobre a `feat/visualizador-v2`. **Ordem de merge: E4 → E5 → V2 → V3**, todas por merge comum (não squash).
- **V2 completo** na branch `feat/visualizador-v2` (V2a–V2e), empilhada sobre a `feat/mapa-incremental`. Ordem de merge: E4 → E5 → V2. Ver "V2 — desenho e tarefas" na seção "Visualização do grafo".
- **E5 — pronta, menos a medição paga** na branch `feat/mapa-incremental`: 5a–5d, 5f e a parte gratuita da 5e. Para medir: `ANTHROPIC_API_KEY=... npm run measure:chaos -- --sim-gastar` (estimativa abaixo de US$ 0,50).

| Tarefa | Branch | Status |
|---|---|---|
| 1a. Fase 0: imports (tsconfig paths, require, barrels, default, alias, namespace) | `feat/chaos-grafo` | concluído, mergeado |
| 1b. Fase 0: chamadas (this, instâncias, params tipados, references) | `feat/chaos-grafo` | concluído, mergeado |
| 1c. Fase 0: snapshot unificado + exemplo `checkout-express` com 100% de cobertura | `feat/chaos-grafo` | concluído, mergeado |
| 1d. Extratores de regras sem regex: Java/Python/C# para Tree-sitter; PL/pgSQL por analisador léxico; HTML/CSS para Tree-sitter | `feat/chaos-grafo` | concluído, mergeado |
| V1. Visualizador de conferência do mapa (`shieldepy graph --html`) | `feat/grafo-visualizador` | concluído, mergeado |
| 2. E2 / Fase 1: topologia (`topology-graph.json`, rotas, I/O, CLI `topology`), tarefas 2a–2f | `feat/topologia` | concluído, mergeado (PR #3) |
| V2. Visualizador de produto: resultados do caos e diff do PR no mapa (CLI e extensão), tarefas V2a–V2e | `feat/visualizador-v2` | concluído, mergeado (PR #6) |
| V3. Portal: resultados do caos enviados pelo CI e mostrados no `apps/frontend`, tarefas V3a–V3e | `feat/portal-v3` | concluído, mergeado (PR #7) |
| 3. E3 / Fases 2–3: LangGraph + agentes (tarefas 3a–3f, ver "E3 — contexto") | `feat/chaos-agentes` | concluído, mergeado (PR #4) |
| 4. E4 / Fase 4: execução, gate, GitHub Actions (tarefas 4a–4e, ver "E4 — contexto") | `feat/chaos-gate` | concluído, mergeado (junto do PR #6); falta o PR de teste no GitHub |
| 5. E5: mapa incremental e custo (ids estáveis, diff de mapas, caos só no que o PR tocou, medição de custo), tarefas 5a–5f | `feat/mapa-incremental` | mergeado (junto do PR #6); falta a medição paga (5e) |
| R. Jornada do usuário e release da extensão (modo local, primeiros passos, caos no editor, `.vsix`), tarefas R1–R4 | `feat/jornada-release` | concluído; falta o merge e publicar o release |
| 6. E6: grafo de chamadas para Python (Java e C# saíram do roadmap em 2026-10-09) | a definir | talvez, depois do release |

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
- 2026-10-08: **E5 iniciada** (mapa incremental e custo), na branch `feat/mapa-incremental`, empilhada sobre a `feat/chaos-gate` (a E4 foi enviada, mas ainda não mergeada). A antiga E5 (outras linguagens) virou E6. Ver a seção "E5".
- 2026-10-08: **5a concluído (ids estáveis).**
  - O id de símbolo passou de `arquivo#nome:linha` para **`arquivo#Contêiner.nome`** (ex.: `src/services/CheckoutService.ts#CheckoutService.checkout`). Nome repetido no mesmo arquivo ganha `~2`, `~3` pela ordem; um repetido novo no fim não renumera os de antes.
  - **Decisão: o contêiner entra no id.** Dois `save` em classes diferentes do mesmo arquivo não dependem do sufixo de ordem, que é a parte menos estável.
  - O id nasce num lugar só (`extract-ts.ts`, `stableIds`), atribuído depois da varredura. A linha continua em `startLine`, que é o que o visualizador e a extensão já usavam.
  - O `in` das operações na superfície passou a sair qualificado (`StripeGateway.charge` em vez de `charge`): informa melhor a IA e o relatório.
  - **Correção ao plano:** o `contentHash` do mapa **muda** quando as linhas se deslocam, e deve mudar, porque o mapa guarda `startLine` e `arquivo:linha`. O que não muda são os ids e as arestas, e é sobre eles que o diff da 5c trabalha. O teste confere isso: comentário e linhas em branco acima de tudo mantêm os mesmos nós e arestas.
  - Cobertura do `packages/` igual (1468 resolvidas, 7 heurísticas, 2 sem alvo, 0 imports quebrados), com 1 símbolo a mais: antes, dois símbolos de mesmo nome na mesma linha caíam no mesmo id. Agora há 21 ids com `~n` no `packages/`.
  - Suíte: **291 testes**.
- 2026-10-08: **5b concluído (hash do corpo e do código de topo)**, em `code-graph/fingerprint.ts`.
  - **`bodyHash`** (16 hex de um SHA-256) das folhas da AST do símbolo, em ordem: tipo + texto, sem comentários. Pontuação e operadores entram (`x + 1` ≠ `x - 1`). O **nome do próprio símbolo fica de fora**, então renomear sem mexer no corpo mantém o hash. Quando o nó hasheado é o próprio símbolo (método, classe), o nó `name` é pulado; em `const f = () => {}`, o hash é da função.
  - **`topHash`** no nó de arquivo TS/JS: as folhas **fora** de todos os símbolos (imports, constantes, montagem, `export const svc = new Svc(...)`). Mudar o corpo de uma função não mexe nele.
  - Calculados no mesmo parse do `updateFile`, sem segundo parse. Os dois vão para o `SystemGraph` (`bodyHash` nos símbolos e `topHash` nos arquivos).
  - O hash da classe inclui os métodos, então mudar um método muda a classe também. O diff vai olhar os métodos; a classe só serve de contexto.
  - **Custo medido:** no pior caso (duas varreduras completas por arquivo), 169 ms de 1,9 s para indexar 99 arquivos do `packages/`, cerca de 9%. Numa edição na extensão, 1 a 2 ms.
  - Testes: comentário, espaço e linhas acima não mudam nada; `x + 1` → `x - 1` muda só aquele método (e a classe); renomear mantém o hash; o topo muda com import e com constante exportada, e não com o corpo.
  - Suíte: **295 testes**.
- 2026-10-08: **5c concluído (diff entre mapas)**.
  - **`diffSystemGraphs(base, head)`** (`core/src/map-diff.ts`): operação de conjunto sobre os ids estáveis. Devolve símbolos `added/removed/changed` (mesmo id, `bodyHash` diferente) e `renamed`, arquivos `added/removed/topChanged`, arestas `added/removed` e `empty`.
  - **Renomeação:** sumiu um símbolo e apareceu outro no **mesmo arquivo**, do mesmo tipo e com o mesmo corpo, pareados na ordem dos ids. Mover para outro arquivo continua sendo remoção mais adição (decisão: mover muda imports e quem chama, e tratar como mudança é o lado seguro). As arestas do lado base são remapeadas pela renomeação antes de comparar, então renomear não gera ruído; só aparece a chamada que ficou órfã.
  - **Base pelo git** (`apps/cli/src/git-base.ts`):
    - o commit base é o **merge-base** entre o ref e o HEAD, como num PR;
    - a pasta é montada naquele commit num `git worktree --detach` temporário, apagado no fim;
    - os dois mapas são construídos **pelo mesmo motor** (o código atual), então mudar o motor entre os commits não vira diff;
    - pasta que não existia na base dá mapa vazio;
    - `changedFiles` junta o `git diff --name-only` (inclusive o não commitado) e os arquivos novos não rastreados. É o que a 5d usa para a regra conservadora (config/deps);
    - ref inexistente ou pasta fora de um repositório git → `GitBaseError` → exit 2.
  - **CLI:** `shieldepy diff <pasta> --base <ref> [--json]`.
  - **Testes** (cópia do `checkout-express` num repositório git temporário):
    - comentário e linhas em branco: o git vê mudança, o mapa não (`empty`);
    - `currency: 'brl'` → `'usd'`: só `StripeGateway.charge` (e a classe) em `changed`, sem aresta nova;
    - `findById` → `getById`: `renamed`, com a chamada órfã de `CheckoutService.find` nas arestas removidas;
    - montagem no `container.ts`: `topChanged`; arquivo novo: `files.added` e o símbolo novo;
    - ref inexistente e pasta sem git: exit 2.
  - Suíte: **300 testes**.
- 2026-10-08: **5d concluído (caos só no que o PR tocou).**
  - **Topologia:** cada rota ganhou `reach`, com todo símbolo percorrido a partir dos handlers (ids estáveis, ordenados). Não vai para a superfície nem para a IA.
  - **`affectedRoutes(base, head, diff, changedFiles, setupFiles)`** (`core/src/topology/affected.ts`). Uma rota de agora entra, com o motivo escrito, se:
    - é nova;
    - a cadeia de handlers mudou;
    - as operações ou as tags mudaram;
    - um símbolo do alcance mudou, é novo ou foi renomeado (alcance de agora) ou sumiu (alcance de antes);
    - o código de topo mudou no arquivo de registro da rota ou num arquivo do alcance.
  - **Mudança global → todas as rotas:** `shieldepy.chaos.config.ts`, um `setupFiles`, `package.json`, lockfiles, `.npmrc`, `tsconfig*.json` e `vite/vitest.config`. Decisão conservadora: na dúvida, a rota entra.
  - **`shieldepy chaos --base <ref>`:**
    - monta a topologia da base (worktree da 5c) e filtra a superfície **antes** da IA. Rotas e colisões de fora não custam token nem teste;
    - sem rota sensível tocada, o pipeline roda com a superfície vazia (sem chamada à IA, sem teste) e sai **0**;
    - o texto, o `--json` (`scope`) e o relatório mostram o escopo: base e merge-base, cada rota tocada com o motivo, as não tocadas, e "todas, porque mudou X";
    - o relatório tem um status próprio: "Nenhuma rota sensível tocada por este PR".
  - **Furo achado e fechado:** os testes gerados ficam em `.shieldepy/chaos-tests/`, com um `vitest.config.ts`. Num repositório que não ignore `.shieldepy/`, ele apareceria como arquivo novo e dispararia "todas as rotas". A lista do git agora descarta as pastas que o mapa ignora (`IGNORED_DIRS`).
  - **Aceitação, testada numa cópia do `checkout-express` em git temporário:**
    - só comentário → nenhuma rota tocada, nenhum teste, exit 0;
    - corpo do `StripeGateway.charge` → só `POST /checkout` ("código no caminho mudou: …StripeGateway.charge"), e `GET /orders/:id` fica de fora;
    - corpo do `OrderRepository.findById` → só `GET /orders/:id`, que não tem falha testável, então nenhum teste;
    - `package.json` → todas, com o motivo.
  - Suíte: **306 testes**.
- 2026-10-08: **5f concluído (CI com `--base`)**, feita antes da 5e (que depende de autorização para a chamada paga).
  - **Template para repositórios-alvo:** `fetch-depth: 0` e, em PR, `--base origin/$GITHUB_BASE_REF`. Em push e execução manual, o mapa inteiro.
  - **Neste repositório (decisão):** o que muda nos PRs costuma ser o próprio **motor**. Com `--base` sempre ligado, um PR só no motor não testaria nada no portão. Por isso o `chaos-gate` usa `--base origin/<destino>` só quando `git diff --quiet origin/<destino>...HEAD -- packages apps` (o PR não toca o motor); senão, roda completo. O `self-test` continua sempre completo.
  - O roteiro do PR de teste da 4e continua valendo: tirar o timeout do `-fixed` só mexe no exemplo, então o portão usa `--base`, o `POST /checkout` entra (o corpo de `StripeGateway.charge` mudou) e o teste de timeout quebra.
  - Simulado localmente: esta branch mexe no motor (portão completo). `chaos -fixed --base HEAD` sai 0, com "Nenhuma rota sensível tocada por este PR" no relatório. YAML validado.
  - Docs: seção "Só o que o PR tocou (`--base`)" no `docs/chaos-ci.md`; o README ganhou o `diff`, o `--base` e os arquivos novos no mapa do código.
- 2026-10-08: **5e, parte gratuita.** A medição paga não foi feita: não há `ANTHROPIC_API_KEY` neste ambiente, e gastar exige autorização do usuário.
  - **Risco achado no provider:** o Sonnet 5.5 (e o Opus 5.5) raciocinam por padrão, e esse raciocínio também consome o `max_tokens`. Com 4000 no Threat Modeler e 800 nos especialistas, a resposta pode sair cortada no meio do JSON, e antes isso aparecia como "JSON inválido". Agora o provider da Anthropic lança "resposta cortada no limite de N tokens (stop_reason: max_tokens) — modelo" **quando a resposta é JSON**. Texto livre (o chat da extensão) cortado continua sendo entregue. A medição vai dizer se é preciso subir o `maxTokens` ou baixar o esforço no tier `deep`.
  - **`cacheSystem`:** mantido e documentado no `provider.ts`. Abaixo do mínimo ele não faz nada (sem erro e sem custo); hoje só o Threat Modeler no Sonnet 5.5 cacheia, e só entre execuções com menos de 5 min de intervalo. Não vale encher o prompt para chegar aos 4096 do Haiku.
  - **Medição pronta para o usuário rodar:** `ANTHROPIC_API_KEY=... npm run measure:chaos -- --sim-gastar` (`scripts/measure-chaos-cost.ts`, incluído no typecheck).
    - Roda o `chaos` completo (gera, roda os testes e escreve o relatório com o parágrafo da IA) nos dois exemplos, com o `deep` no Haiku 4.5 e no Sonnet 5.5, e o `fast` sempre no Haiku 4.5.
    - Imprime uma tabela (hipóteses e quantas vieram da IA, descartadas, erros, chamadas, tokens, cache, US$, segundos) e grava o JSON em `.shieldepy/`.
    - Sem `--sim-gastar` ou sem a chave, recusa e sai 2.
    - **Estimativa:** abaixo de US$ 0,50 no total (4 execuções; cada uma faz de 1 a 6 chamadas pequenas).
  - **Decisão adiada até a medição:** o padrão do `deep` e a separação entre o tier do caos e o tier do chat.
- 2026-10-08: **Conferência final da E5.**
  - O E2E acusou 1 falha: o cenário "Ver Mapa do Sistema" procurava as arestas pelos ids antigos (`CheckoutController.ts#create`). Atualizado para os ids estáveis (`#CheckoutController.create` etc.). Depois disso, **E2E 24/24** num VS Code real.
  - **307 testes** unitários, typecheck limpo, extensão com **613 KB** (+1 KB, do hash).
  - **Estado:** pronta para subir e mergear quando o usuário quiser. A medição paga da 5e pode entrar depois, num commit próprio, sem bloquear o merge. A branch está empilhada sobre a `feat/chaos-gate`: mergear a E4 primeiro.
- 2026-10-08: **Estimativa de custo (sem chamada paga) e relatório `RELATORIO-CUSTO-IA.md` na raiz.**
  - **Método:** `npm run estimate:chaos` (`scripts/estimate-chaos-cost.ts`) roda o pipeline real nos dois exemplos com um provider que grava cada requisição real e devolve respostas válidas de tamanho realista. Tokens a 3,5 caracteres por token (faixa de 2,8 a 4,2); raciocínio do Sonnet/Opus de 0 a 3.000 tokens por chamada.
  - **Resultado:** o vulnerável faz 6 chamadas (~7,3k tokens de entrada / ~1k de saída) e custa **~US$ 0,012 só com Haiku** e **~US$ 0,026 com o Threat Modeler no Sonnet 5.5**. O corrigido faz 4 chamadas (~US$ 0,008 / 0,022). A saída real é ~6× menor que a estimativa antiga do plano.
  - **Escala:** 20 rotas sensíveis custam ~US$ 0,10 a 0,14; 100 rotas, ~US$ 0,48 a 0,66 por execução completa. Com `--base`, ~US$ 0,18 a 0,39 por mês para 100 PRs.
  - **Achado:** o `max_tokens: 4000` do Threat Modeler estoura a partir de ~7 rotas de escrita. Virou a tarefa **5g**.
  - **Recomendação do relatório:** manter tudo no Haiku até a medição real; corrigir os lotes; decidir o Sonnet no Threat Modeler pela qualidade (a diferença de custo é de ~US$ 0,014 por execução); não usar o Sonnet nos especialistas.
  - A medição real continua pendente: `npm run measure:chaos -- --sim-gastar`.
- 2026-10-08: **V2 iniciado** (branch `feat/visualizador-v2`, empilhada sobre a `feat/mapa-incremental`). O portal virou o **V3**: precisa que o CI envie os resultados (endpoint autenticado e armazenamento), o que é uma etapa à parte.
- 2026-10-08: **V2a concluído (resultado do caos persistido).**
  - **`ChaosResults`** (`agent/src/chaos/results.ts`, com `buildChaosResults`): projeto, `topologyHash`, motor, se rodou, erro de ambiente, portão (`failOn`, `hits`), escopo do PR, cada resultado com severidade, mensagem e **arquivo do teste**, e as hipóteses sem teste com o motivo ("precisa de falha injetada no banco", "não executado (--no-run)" etc.). O `ChaosScope` mudou do `report.ts` para o `results.ts`.
  - O `chaos` grava **sempre** o `.shieldepy/chaos-results.json` (também com `--no-run`, com `ran: false`).
  - **`--html <arquivo>`** no `chaos` e no `diff`: o visualizador com a topologia e o overlay. No `chaos --base`, o diff do PR vai junto. No `diff`, as rotas tocadas (`affectedRoutes`) também vão, e a saída de texto lista cada rota tocada com o motivo.
  - **Visualizador:** `renderGraphHtml(..., overlay?)`, com `ViewerOverlay { chaos?, diff? }` embutido como `OVERLAY`. Os tipos são **mínimos e próprios** do visualizador (estruturalmente iguais aos do agent), para ele não depender do pacote de agentes, que puxa o LangGraph. Sem overlay, nada muda.
  - Suíte: **308 testes**.
- 2026-10-08: **V2b concluído (caos no visualizador).**
  - **Seção "Caos" no topo da barra lateral** (com um resultado aberto, ela é o assunto principal). Traz:
    - o banner: bloqueado, aguentou, nenhuma rota tocada, não executado (`--no-run`) ou erro de ambiente;
    - um aviso quando o resultado é de **outra versão do mapa** (`topologyHash` diferente);
    - os chips de contagem, neutros quando zero, e o escopo do PR;
    - os **achados como cartões** (severidade, rota, falha, alvo, tempo, invariante violada e arquivo do teste). Clicar abre o fluxo da rota; no webview, há também "Abrir teste" (mensagem `openTest`, tratada na V2d);
    - as listas "Aguentou", "Inválidos" e "Sem teste nesta execução", e a legenda.
  - **No grafo:** rota com achado em vermelho (borda grossa) e com `✖` no rótulo; aguentou com borda verde e `✓`; inválido com borda tracejada. A operação de I/O alvo de um achado ganha borda vermelha, e isso vale também no modo fluxo. A lista de rotas mostra o mesmo ícone.
  - **Conferido em screenshots no Chrome headless:** o vulnerável mostra "Bloqueado: 4 achado(s)", a rota `✖ POST /checkout` e o Stripe e as operações em `stock` marcados; o corrigido mostra "O código aguentou todas as falhas injetadas" e `✓ POST /checkout`. Os ajustes que os screenshots pediram: o caminho do teste vazava do cartão, e o vermelho da rota quebrada se confundia com o rosa normal das rotas (daí o `✖`/`✓` no rótulo).
  - O script do visualizador continua compilando (teste da CLI); sem overlay, nada muda.
- 2026-10-08: **V2c concluído (diff do PR no visualizador).**
  - **No grafo:**
    - símbolo novo: borda verde;
    - corpo alterado: âmbar;
    - renomeado: azul tracejada (o painel de detalhes mostra "renomeado de");
    - arquivo novo ou com o código de topo alterado: a caixa ganha borda;
    - **rota tocada pelo PR:** borda dupla âmbar, com o motivo nos detalhes. As rotas tocadas vêm do `diff` (`affectedRoutes`) ou, num `chaos --base`, do escopo.
  - **Seção "Mudanças do PR"** (logo depois da "Caos"): base e merge-base, chips de novos, alterados, renomeados e removidos, e listas clicáveis. Rota tocada abre o fluxo; símbolo dá foco. Os removidos aparecem só como texto, porque não estão mais no mapa.
  - **Filtro "só o que o PR mudou (e os vizinhos)":** só aparece com diff. Mostra os nós mudados, os vizinhos diretos e as rotas tocadas. O link `#mudancas` já abre filtrado (útil no artefato do CI).
  - **Conferido no Chrome headless**, com `currency: 'brl'` → `'usd'` no `StripeGateway`: o `charge` e a classe em âmbar, o `POST /checkout` como tocado, e, filtrado, só `charge`, `StripeGateway`, `checkout`, `api_call api.stripe.com` e a rota com os handlers. Ajuste pedido pelo screenshot: ids longos quebram linha nos botões.
  - Teste: `diff --html` embute o diff e as rotas tocadas, e o script compila.
  - Suíte: **308 testes**.
- 2026-10-08: **V2d concluído (extensão).**
  - **`git-base` foi da CLI para o core** (`packages/core/src/git-base.ts`; só Node, sem rede), porque a CLI e a extensão usam.
  - **Painel do mapa:**
    - lê o `.shieldepy/chaos-results.json` do workspace: o da raiz, se houver; senão, o mais recente, e o painel mostra de qual projeto ele é;
    - um `FileSystemWatcher` atualiza o painel aberto quando a CLI grava um resultado novo;
    - "Abrir teste" abre o arquivo do teste, resolvido a partir da pasta do projeto, sem sair da raiz do workspace.
  - **Decisão: desatualização por data na extensão.** A extensão monta o mapa a partir da raiz do workspace, e a CLI a partir da pasta do projeto, então o `topologyHash` nunca bate lá. O resultado é marcado como desatualizado quando algum arquivo do mapa dentro do projeto foi alterado depois dele. O visualizador ganhou `ViewerChaos.stale`; sem ele, vale o hash (CLI).
  - **Comando "ShielDepy: Comparar Mapa com uma Branch"** (`shieldepy.compareMap`): pede o ref (padrão `origin/main`), monta o mapa do merge-base num worktree temporário, indexado à parte, e mostra o diff e as rotas tocadas no painel, com um resumo numa notificação. O diff fica no painel até ele fechar.
  - **Limite anotado:** o mapa atual vem da extensão (com o teto e as exclusões dela), e o da base é indexado inteiro. Num repositório acima do teto, ou com arquivos fora do git que a extensão indexa, o diff pode mostrar "novos" que não são do PR.
  - **E2E: 27/27.** O `run.mjs` agora cria um repositório git de verdade, com o mesmo remote e a mesma branch, porque o worktree precisa de um commit. Três cenários novos:
    - um resultado gravado aparece no painel (não desatualizado);
    - um resultado regravado atualiza o painel aberto sozinho;
    - "Comparar com HEAD" depois de mudar o `StripeGateway.charge` → `changed`, com `POST /checkout` tocada e `GET /orders/:id` de fora, e o caos continua no painel.
  - Extensão com **636 KB** (era 613; entraram o diff e o `git-base`). Suíte unitária: **308**.
- 2026-10-08: **V2e concluído (escala), e com ele o V2.**
  - **Medição** (Chrome headless, tempo até o layout terminar, com um script injetado logo depois do visualizador):

    | Grafo | Nós | Arestas | Layout pronto |
    |---|---|---|---|
    | `checkout-express` | 68 | 113 | 0,4 s |
    | `apps/` (real) | 3.526 | 14.848 | 6,9 s |
    | sintético | 2.200 | 5.899 | 3,0 s |
    | sintético | 5.500 | 14.744 | 7,3 s |
    | sintético | 11.000 | 29.482 | 8,2 s |
    | sintético | 22.000 | 58.959 | 7,8 s |

    Acima de 6 mil elementos o visualizador já usa o layout de rascunho, então o tempo **estabiliza em ~8 s até 22 mil nós**.
  - **Decisão: não trocar de biblioteca agora.** O Sigma.js (WebGL) aguentaria mais, mas não tem nós compostos (o agrupamento por arquivo) e exigiria reescrever o visualizador. O ELK não é necessário: os fluxos de rota são pequenos e o `breadthfirst` dá conta. Nesse tamanho, o problema é de **leitura**, não de velocidade. **Gatilho para reavaliar:** mapas acima de ~50 mil nós ou travamento na interação.
  - **O que entrou:** em mapa grande (mais de 3 mil nós) com diff, o visualizador já abre filtrado em "só o que o PR mudou".
  - **Observação antiga resolvida:** o `.vscode-test` (o VS Code baixado pelo E2E) entrou no `IGNORED_DIRS`. O `graph apps` sai em ~19 s, com 3.526 nós; antes, varria milhares de arquivos JS do VS Code.
  - **CI:** o portão grava o mapa (`--html`) e o anexa como artefato do job (`shieldepy-mapa`), no workflow e no template. O guia diz como abrir, inclusive com `#mudancas`.
  - README: seção do visualizador com o resultado e os arquivos novos no mapa do código.
  - **Estado final do V2:** 308 testes unitários, E2E 27/27, extensão com 636 KB. Pronto para o merge, depois da E4 e da E5.
- 2026-10-08: **5g concluído (lotes no Threat Modeler)**, feito na `feat/visualizador-v2`, que é a ponta da pilha (E4 → E5 → V2): mexer na `feat/mapa-incremental` exigiria rebasear o V2 inteiro. Entra junto com o merge do V2.
  - **`surfaceBatches`:** lotes de **5 rotas** (`ROUTES_PER_BATCH`), cada um só com as colisões que tocam as suas rotas.
  - **Execução:** um Threat Modeler por lote, em paralelo, no máximo 4 ao mesmo tempo (um `pool` simples, por causa do limite de requisições da API).
  - **`max_tokens`** = 2.000 + 1.000 por rota (7.000 num lote de 5), com folga para o raciocínio do Sonnet/Opus 5.5.
  - **Junção:** os lotes não se sobrepõem, então as hipóteses da IA são concatenadas e passam pelo `mergeHypotheses` com a lista-base, que nunca encolhe. Os descartes e os erros dizem o lote ("lote 2/3: …"). Um lote que falha não derruba os outros, e `engine` é o provider se pelo menos um lote respondeu.
  - **Interface:** o `ThreatModel` passou de `completion`/`error` para `completions`/`errors` (uma chamada por lote). O grafo LangGraph foi ajustado.
  - **Cache:** não serializei o primeiro lote para aquecer o cache. O ganho seria de ~US$ 0,001 por lote no Sonnet, e não paga a latência.
  - **Testes:** 12 rotas → 3 chamadas (5, 5, 2), `max_tokens` 7.000/7.000/4.000, a colisão só no lote da rota dela e as 12 hipóteses da IA entram. O lote 2 falhando → o erro diz "lote 2/3", os lotes 1 e 3 mantêm a contribuição da IA e a base fica inteira.
  - **`RELATORIO-CUSTO-IA.md` atualizado:** o achado aparece como corrigido, e a escala e o custo mensal incluem o prompt de sistema e o raciocínio repetidos por lote. 100 rotas: ~US$ 0,49 só com Haiku e ~US$ 0,87 com o Threat Modeler no Sonnet.
  - Suíte: **310 testes**.
- 2026-10-08: **V3 iniciado** (branch `feat/portal-v3`, empilhada sobre a `feat/visualizador-v2`). **V3a concluído (contrato e `publish`).**
  - `ChaosResults` ganhou `surface` (a superfície de ataque inteira, só fatos), que o portal desenha. O `ChaosRunUpload` é o que vai para o portal: remote, commit, branch, PR, link do job e o resultado.
  - `repoInfo(dir)` no `git-base` do core lê o remote `origin`, o commit e a branch.
  - **`shieldepy publish <pasta> --portal <url> [--append-link <relatório.md>]`**, com o token em `SHIELDEPY_PORTAL_TOKEN`:
    - lê o `.shieldepy/chaos-results.json`;
    - tira o PR, a branch e o link do job das variáveis do GitHub Actions (`GITHUB_REF` `refs/pull/N/merge`, `GITHUB_HEAD_REF`, `GITHUB_RUN_ID`);
    - faz o POST em `/api/ci/chaos-runs` e devolve o link da execução;
    - com `--append-link`, acrescenta o link ao relatório do PR.
  - Erro de configuração, portal fora do ar ou recusa → exit 2 com o motivo. No CI, o passo é separado do portão.
  - Testes: o payload completo num repositório git temporário com um portal falso, os erros (sem token, sem portal, sem resultado, 403, rede) e o contexto do CI em PR e em push.
  - Suíte: **313 testes**.
- 2026-10-08: **V3b concluído (servidor do portal).**
  - **Banco:** tabelas `project_ci_tokens` (só o hash, `sdci_…`, revogável) e `chaos_runs` (resumo em colunas mais o resultado em JSON), com índice por repositório e data (`server/auth/chaosRuns.ts`).
  - **Status de uma execução numa palavra** (a cor no portal): `blocked`, `passed`, `below_gate`, `nothing` (nenhuma rota tocada), `not_run`, `error`, `invalid`.
  - **Rotas:**
    - o dono lista, cria e revoga tokens (`/api/projects/:id/ci-tokens`);
    - o CI publica (`POST /api/ci/chaos-runs`, `Authorization: Bearer sdci_…`) só em repositório do projeto do token, com o remote comparado normalizado (https, ssh e `.git` dão o mesmo). A resposta traz o link (`PUBLIC_URL` → `OAUTH_REDIRECT_BASE` → `Host`);
    - a visão do projeto (`/api/projects/:id/chaos`: a última execução e as 24 mais recentes de cada repositório) e a execução completa (`/api/projects/:id/chaos/runs/:runId`).
  - **Segurança:**
    - o payload é validado (versão, remote, commit, forma do resultado);
    - **links que não são http(s) são descartados**, porque viram `<a href>` no portal (nada de `javascript:`);
    - empresa suspensa não publica;
    - outra empresa recebe 404;
    - o token de um projeto não publica em outro.
  - **Retenção:** as últimas 100 execuções por repositório, aplicada a cada inserção.
  - **Dois ajustes no servidor:**
    - `SHIELDEPY_DATA_DIR` permite pôr o banco em outra pasta (os testes usam uma temporária);
    - o `node:sqlite` passou a ser carregado com `createRequire`. O Vite (Vitest) não conhecia esse módulo nativo e tentava resolver um pacote `sqlite`; por isso nenhum teste tocava no banco até agora.
  - **Testes** (`apps/frontend/test/chaos-runs.test.ts`, com sessões e HTTP de verdade): tokens só pelo dono, valor único e fora da lista; publicação com remote escrito de outro jeito; 401, 403 (repositório fora do projeto, token de outro projeto) e 400; link `javascript:` descartado; token revogado; visão do projeto `blocked`; execução completa; 404 para outra empresa; retenção de 100.
  - Suíte: **321 testes**.
- 2026-10-08: **V3c e V3d concluídos (portal: projeto e execução).** As duas páginas saíram juntas, num commit só, porque foram desenhadas e conferidas juntas.
  - **Decisão de design:** o mapa de grafos (Cytoscape) é ferramenta de conferência e ficou "cru" para o usuário. No portal, a peça central é **a rota e o que acontece nela**, numa visualização própria em React e CSS, sem biblioteca de grafo, no design system do portal (tokens, temas claro e escuro, entrada escalonada).
  - **Página do projeto:**
    - painel **"Caos no CI"** no topo da coluna principal: um cartão por repositório com o status da última execução (borda colorida), quando, PR ou branch, commit, contagens e a **faixa de histórico** (uma barra por execução, a altura é o número de achados, a cor é o status). Cada barra abre a sua execução; o cartão inteiro abre a última, por um link esticado sem `<a>` dentro de `<a>`;
    - painel **"Integração com o CI"** (só o dono): criar token num modal, o valor aparece **uma vez** numa caixa em destaque com botão de copiar, lista com o último uso, e revogar. O passo a passo cita `SHIELDEPY_PORTAL_TOKEN` e `SHIELDEPY_PORTAL_URL`.
  - **Página da execução** (`/projects/:id/runs/:runId`):
    - topo com o brilho no tom do status (anel pulsando quando bloqueou), a frase ("4 achados barraram este PR"), commit, branch, links para o PR e o job do CI, horário, motor e custo da IA;
    - quatro métricas: achados, aguentaram, inválidos e sem teste;
    - o escopo do PR, quando houver;
    - **cada rota como uma linha do tempo**: a entrada (handlers e arquivo:linha) e cada operação de I/O como uma estação com ícone, verbo ("lê", "grava", "chama"), alvo, função, arquivo:linha e marcas ("sem timeout", "FOR UPDATE", "por nome"), ligadas por um traço animado. **A estação atingida por um achado** fica no tom da severidade, com um anel pulsando e um selo ("Corrida", "3 falhas");
    - abaixo, os **cartões dos achados** (severidade, falha em português, a falha injetada, o tempo, a invariante violada em destaque e o arquivo do teste) e os chips do que aguentou, do inválido e do que ficou sem teste;
    - rotas com achado vêm primeiro; uma rota fora do escopo do PR fica tracejada;
    - o histórico do repositório no fim.
  - Os textos de status, falhas, operações e tags ficam num lugar só (`src/portal/chaos/labels.ts`). Ícones novos: banco, nuvem, alerta, relógio, raio, copiar, commit.
  - **Conferência visual com dados reais:** portal local num banco temporário, `chaos` + `publish` de verdade nos dois exemplos (6 publicações com PRs diferentes) e screenshots pelo protocolo do Chrome com sessão real, nos temas claro e escuro e no celular. Ajustes que os screenshots pediram:
    - o `<header>` da rota herdava o estilo global da barra do topo (virou `div`);
    - "4 no portão (Baixo ou pior)" virou "todos contam no portão";
    - nomes e caminhos longos só quebram linha no `.` e na `/`;
    - o tempo do achado foi para a linha da falha injetada;
    - o teste mostra o nome do arquivo, com o caminho inteiro na dica.
  - No celular, a linha do tempo vira vertical, com as setas para baixo.
- 2026-10-08: **V3e concluído, e com ele o V3.**
  - **CI:** passo "Publicar no portal" no workflow e no template.
    - Só roda se existirem o secret `SHIELDEPY_PORTAL_TOKEN` e a variável `SHIELDEPY_PORTAL_URL`.
    - Vem **antes** do comentário no PR, com `--append-link "$REPORT"`, para o link da execução entrar no relatório.
    - Usa `continue-on-error`: o portal nunca muda o portão.
    - Neste repositório, só o `chaos-gate` publica; o `self-test` barra sempre, de propósito, e poluiria o histórico.
  - **Simulado com o portal local:** o `publish` com as variáveis do GitHub Actions publicou a execução 7 e acrescentou "[Ver esta execução no portal do ShielDepy](…/projects/1/runs/7)" ao relatório. YAML validado.
  - **Docs:** a seção "Portal: o histórico de cada repositório" no `docs/chaos-ci.md` (criar o token, guardar no GitHub, o que vai para o portal, retenção) e o README (o `publish`, o portal e os arquivos novos no mapa do código).
  - **Estado final do V3:** 321 testes unitários (28 do portal, 8 deles do V3b), extensão com 636 KB (sem mudança: o V3 não toca nela). As páginas foram conferidas em screenshots nos temas claro e escuro e no celular. O servidor e o banco temporários da conferência foram desligados e apagados.
  - **Para usar de verdade:** subir o portal com `PUBLIC_URL` (ou `OAUTH_REDIRECT_BASE`) apontando para o endereço público, criar o token na página do projeto e configurar o secret e a variável no GitHub.
- 2026-10-09: **R1 concluída (modo local).**
  - **Portão:** o motor só depende de `shieldepy.backgroundAnalysis.enabled`. Saíram o `setPathGate`/`isAllowedPath` (filtro por pasta liberada), o `requireAccess` dos comandos e o contexto `shieldepy.unlocked` (o chat fica sempre na barra lateral).
  - **A conta só decide a IA:** `AuthService.companyAiBlock()` devolve `suspended`, `repoBlocked`, `aiDisabled` ou `null`. Sem conta é sempre `null` e vale a chave do usuário; `hasAiAccess()` virou "a empresa não bloqueia".
  - **Telas:** o painel perdeu a tela de bloqueio de página inteira. No lugar, um aviso discreto acima dos ladrilhos, só quando a empresa desliga a IA, com "Verificar de novo" e o painel web. O cabeçalho diz "Modo local" sem conta. O chat trava só com bloqueio da empresa (texto por motivo). A barra de status nunca mostra "Entrar": a dica diz modo local ou empresa, e avisa a IA desligada.
  - **Textos** nos 4 idiomas: 14 chaves de "entre para usar" saíram, 5 entraram (`localMode`, `sbLocalTip`, `sbAiOff`, `lockAiOffTitle`, `lockAiOffText`) e as de bloqueio foram reescritas como "a análise local continua; a IA…".
  - **Ao mudar a conta**, os arquivos abertos são reanalisados (os riscos da IA aparecem ou somem); nada mais é limpo.
  - **E2E 27/27** (os mesmos 27 de antes, reescritos; o commit da R1 diz "29/29" por engano de contagem): os cenários de suspensão e de repositório agora provam que ciclos e colisões **ficam** e que só o bloqueio da IA muda (`aiBlock()` na API de teste). Unitários: 317 (sem mudança). Extensão: 631 KB.
- 2026-10-09: **R3 concluída (caos no editor).** Feita antes da R2, porque o walkthrough da R2 tem o passo "Testar caos".
  - **O contrato deixou de ser o maior atrito.** Antes, sem `shieldepy.chaos.config.ts` a CLI só imprimia um modelo genérico. Agora `chaosConfigScaffold(surface)` (core) gera o contrato a partir do mapa:
    - uma requisição por rota sensível, com `:id` virando `1`;
    - uma resposta saudável por host externo;
    - `createApp` que lança um erro claro, para o arquivo compilar como está.
  - **Marcas:** o que só o projeto sabe sai com `TODO(shieldepy)`, uma linha por pendência, e `chaosConfigPending()` conta. As invariantes ficam como exemplo opcional. A CLI ganhou `shieldepy chaos <pasta> --init`, que não sobrescreve um contrato existente.
  - **Comando "ShielDepy: Testar Caos"** (`src/chaos/ChaosCommand.ts`), na ordem em que a pessoa precisa:
    1. o projeto: a pasta com `package.json` mais próxima de cada rota sensível do mapa (com mais de um, uma lista);
    2. sem contrato: oferece criá-lo e abre o arquivo;
    3. contrato com pendências: avisa ("N pendências"), com "Abrir o contrato" ou "Rodar mesmo assim";
    4. falta `vitest`, `supertest` ou `msw`: mostra o comando (npm, pnpm ou yarn, pelo lockfile) e oferece rodar num terminal;
    5. escopo: "Só o que mudou desde origin/main" (o primeiro de `origin/main`, `origin/master`, `main` ou `master` que existir) ou "Todas as rotas sensíveis";
    6. motor ou IA: só pergunta se a IA estiver disponível (chave e política da empresa); a chave vai pelo ambiente que a CLI lê (`AiService.cliEnv()`);
    7. roda num pseudoterminal "ShielDepy: caos", com a mesma saída da CLI;
    8. no fim, um aviso por código de saída, com "Ver no mapa" (o painel V2d já pega o resultado) e "Abrir relatório" (`.shieldepy/chaos-report.md`).
  - **Bundle separado:** o pipeline (LangGraph, SDKs) virou `dist/chaos.js` (1,9 MB), carregado por `require` só quando o comando roda. A extensão passou de 631 para 641 KB. A CLI aceita `wasmDir` (`ChaosArgs` e `buildMapOf`), porque no bundle CJS o `defaultWasmDir()` não existe.
  - **Armadilha encontrada:** o runner do Vitest usa `process.execPath`, que dentro do VS Code é o executável do editor. O `spawnProcess` passa `ELECTRON_RUN_AS_NODE=1` quando `process.versions.electron` existe; na CLI nada muda.
  - **Testes:**
    - unitários: 325, nenhum pulado (os exemplos agora têm `npm install`). Novos: 3 do contrato gerado (sintaxe, ida e volta pelo leitor de AST, o pipeline sem reclamar de rota ou API faltando), o `--init` na CLI e o aviso que sugere o `--init`;
    - **E2E 31/31** (27 + 4; o commit da R3 diz "33/33" por engano de contagem). Novos: o projeto é achado, os pacotes faltando, o contrato criado no editor e **o caos rodando de verdade dentro do VS Code** no `checkout-express` (exit 1, corrida e timeout provados). Este último só roda quando o exemplo tem `npm install`.
- 2026-10-09: **R2 concluída (primeiros passos).**
  - **Walkthrough** "Primeiros passos com o ShielDepy" (`contributes.walkthroughs`, id `start`), com 4 passos. Cada um tem um botão de comando, um texto em `media/walkthrough/*.md` e se marca como feito sozinho:
    1. a lista de erros (`onView`);
    2. o mapa;
    3. Testar Caos;
    4. a chave da IA, opcional.
  - Ele abre **uma vez** na primeira ativação (`globalState`; nunca no modo de teste). Depois, pelo comando novo **"ShielDepy: Primeiros Passos"**.
  - **Painel sem achados** virou ponto de partida: "Nenhum problema provado até agora. Próximos passos:" com Ver o mapa, Testar caos nas rotas e Primeiros passos. Com um filtro de severidade ligado, continua só "Nada aqui ainda". São 4 chaves novas nos 4 idiomas.
  - **E2E 32/32:** o walkthrough tem 4 passos, cada mídia existe no pacote, cada passo tem botão e o comando abre. A lista de comandos registrados passou a incluir `runChaos` e `gettingStarted`.
- 2026-10-09: **R4 concluída (pacote). Com ela, a etapa R está completa.**
  - **Ícone:** `media/icon.png`, 256×256 com fundo transparente. É o `logo-mark.svg` do portal (o escudo verde com o foguete), renderizado pelo Chrome headless.
  - **Manifesto:** `icon`, `repository`, `homepage` e `bugs`; README e CHANGELOG da extensão em `apps/vscode/` (o README é a página da extensão, com instalação pelo `.vsix`, o que ela faz, privacidade e configurações). O `.vscodeignore` passou a excluir o `.vscode-test/**` explicitamente.
  - **Portal opcional de verdade:** `shieldepy.webBaseUrl` tem padrão **vazio** (era `http://localhost:3000`, que quebraria o "Entrar" de quem instala o pacote). Sem portal:
    - sem conta e sem chamada de rede (`fetchMe`);
    - o cartão da conta some das configurações;
    - os 4 comandos de conta somem da paleta (contexto `shieldepy.portal`);
    - o `login()` explica o motivo.
  - **Em desenvolvimento:** `"shieldepy.webBaseUrl": "http://localhost:3000"` nas settings (o E2E já faz isso pelo `.vscode/settings.json` do workspace).
  - **Pacote:** `npm run package:vscode` gera `apps/vscode/shieldepy-0.1.0.vsix` (37 arquivos, 1,77 MB). O script usa `--skip-license`: a licença é decisão do usuário (sem `LICENSE`, vale "todos os direitos reservados").
  - **Provado:**
    - o `.vsix` instala limpo num VS Code isolado (`--extensions-dir` temporário);
    - **o E2E inteiro passou contra a extensão instalada do `.vsix`** (`SHIELDEPY_E2E_EXTENSION=<pasta> node test-e2e/run.mjs`), não só contra a pasta de desenvolvimento;
    - E2E **33/33** (+1: sem portal, a conta some e as colisões ficam).
  - **Para publicar o release (o usuário decide e faz):**
    1. `npm run package:vscode`;
    2. `gh release create v0.1.0 shieldepy_p1/apps/vscode/shieldepy-0.1.0.vsix --title "ShielDepy 0.1.0" --notes-file shieldepy_p1/apps/vscode/CHANGELOG.md`.

    Se o repositório for privado, só quem tem acesso a ele baixa. O Marketplace fica para depois: ele precisa de um publisher `shieldepy` criado em marketplace.visualstudio.com e de um token do Azure DevOps.
- Decisão: nada de regex para ler código. O grafo e os extratores novos são 100% Tree-sitter, e os extratores de regras que ainda usam regex migram no marco 1d.
- Confirmado com o usuário: o motor marca os nós críticos; o Threat Modeler é o 1º nó do LangGraph e roteia hipóteses para especialistas por tipo de erro.

---

## R — jornada do usuário e release (escrito em 2026-10-09, antes de começar)

### Por que existe
Conferido no código da `main` (`297c964`), o caminho de quem instala a extensão hoje:
1. **Tudo trava sem conta.** `AuthService.accessState()` é o portão da extensão inteira: sem login e sem o repositório cadastrado num projeto do portal, nem os ciclos e colisões (locais, sem IA) aparecem. O painel mostra só a tela de bloqueio, e o chat some da barra lateral.
2. **O portal não existe fora do localhost.** `shieldepy.webBaseUrl` tem padrão `http://localhost:3000`, então quem instala o `.vsix` clica em "Entrar" e o navegador abre uma página que não existe.
3. **O caos só roda pela CLI.** A extensão mostra o resultado no mapa (V2d), mas não tem como rodar.
4. **Não há "primeiros passos".** Nenhum walkthrough. O usuário cai no painel e tem que descobrir sozinho a ordem: chave da IA, mapa, caos.
5. **Falta o básico do pacote:** ícone PNG (o Marketplace não aceita SVG), README e CHANGELOG da extensão, `repository`.

### Desenho
- **Conta × recursos.** O que é local não depende de conta: indexação, ciclos, colisões, mapa, topologia, comparar com branch e caos offline. A conta passa a valer só para o que é da empresa:
  - **Sem login:** modo local. A IA funciona com a chave do próprio usuário (o dinheiro é dele).
  - **Com login:** vale a política da empresa sobre a IA (`aiEnabled`), e só nos repositórios liberados (`repoBlocked`/`suspended` desligam **a IA**, não o motor). O portal registra o uso como hoje.
  - Motivo: travar o motor de quem entrou com conta, enquanto quem não entrou usa tudo, não faria sentido. A empresa controla o que custa ou o que sai da máquina (a IA), não a análise local.
- **Primeiros passos:** `contributes.walkthroughs` com 4 passos (abrir um projeto JS/TS e ver os achados, ver o mapa, testar o caos, IA opcional), aberto uma vez na primeira ativação. Status bar e painel sem a tela de "Entrar".
- **Caos no editor:** comando "ShielDepy: Testar Caos" reaproveitando o `runChaosCommand` da CLI num bundle separado (`dist/chaos.js`), carregado só quando o comando roda, para o LangGraph não entrar no bundle principal.

### Tarefas
- **R1. Modo local.** ✅ Concluída em 2026-10-09 (ver o registro). Portão do motor sem conta; IA: chave própria sem conta, política da empresa com conta; chat sempre visível; painel sem tela de bloqueio (aviso discreto quando a empresa desliga a IA); status bar sem "Entrar"; a conta vai para "Configurações" como opcional. E2E ajustado.
- **R2. Primeiros passos.** ✅ Concluída em 2026-10-09 (ver o registro). Walkthrough, aberto uma vez; estado vazio do painel com os próximos passos ("Ver mapa", "Testar caos").
- **R3. Caos no editor.** ✅ Concluída em 2026-10-09 (ver o registro). Comando, bundle separado, saída no canal do ShielDepy, resultado no mapa e o relatório aberto no fim.
- **R4. Pacote.** ✅ Concluída em 2026-10-09 (ver o registro). Ícone PNG, README/CHANGELOG da extensão, `repository`, `vsce package` limpo, tamanho conferido e instrução de instalar pelo `.vsix`.

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

### V2 — desenho e tarefas (escrito em 2026-10-08, antes de começar)

> Branch `feat/visualizador-v2`, empilhada sobre a `feat/mapa-incremental` (E5), porque usa o diff de mapas e o escopo do PR. O V1 e a E2 já entregam rotas e operações de I/O como nós (CLI `--html` e painel "Ver Mapa do Sistema"). O V2 põe por cima disso o **resultado do caos** e o **diff do PR**.

**Decisão de escopo: o portal fica para o V3.** O `apps/frontend` hoje é a gestão de projetos, repositórios e equipes, com login e SQLite. Mostrar resultados lá exige o CI **enviar** os resultados (endpoint autenticado com o token de dispositivo, armazenamento por repositório e commit, página nova). O V2 cobre a CLI, cujo HTML autocontido também serve de artefato do CI, e a extensão.

**Contrato:** `ViewerOverlay { chaos?: ChaosResults; diff?: { base, commit, diff: MapDiff } }`, um parâmetro novo e opcional do `renderGraphHtml`. Sem overlay, o visualizador continua igual ao V1.

**Tarefas:**
- **V2a. Resultado do caos persistido.** ✅ Concluída em 2026-10-08. O `chaos` grava sempre `.shieldepy/chaos-results.json` (`ChaosResults`): `topologyHash`, escopo, resultados com severidade e mensagem, hipóteses sem teste, portão e custo. Com `--html <arquivo>`, grava também o visualizador com a topologia e o resultado.
- **V2b. Caos no visualizador.** ✅ Concluída em 2026-10-08.
  - Rota com achado em vermelho (com a severidade), aguentou em verde, inválido tracejado, fora do escopo ou sem teste neutra.
  - Lista lateral "Caos": achados com falha, alvo, invariante violada e arquivo do teste. Clicar abre o fluxo da rota, com a operação-alvo destacada.
  - Legenda.
  - Aviso quando o resultado é de outra versão do mapa (`topologyHash` diferente).
- **V2c. Diff no visualizador.** ✅ Concluída em 2026-10-08.
  - Nós `added` / `changed` / `renamed` marcados.
  - Lista lateral "Mudanças" (inclui os removidos, que não estão no mapa atual) e as rotas tocadas, com o motivo.
  - Filtro "só o que o PR mudou": nós mudados, vizinhos diretos e rotas tocadas.
  - CLI: `diff --html` e `chaos --base --html`.
- **V2d. Extensão.** ✅ Concluída em 2026-10-08.
  - O `git-base` vai para o core (só Node).
  - O painel do mapa lê o `.shieldepy/chaos-results.json` e atualiza quando ele muda.
  - Comando novo "ShielDepy: Comparar mapa com uma branch" (padrão: `origin/main`), que mostra o diff no painel.
  - Cenários E2E.
- **V2e. Escala.** ✅ Concluída em 2026-10-08 (medido; sem troca de biblioteca). Medir o visualizador com o grafo grande (`apps/`) e registrar a avaliação do Sigma.js e do ELK. Só trocar de biblioteca se a medição pedir.

### V3 — portal: resultados do caos enviados pelo CI (escrito em 2026-10-08, antes de começar)

> Branch `feat/portal-v3`, empilhada sobre a `feat/visualizador-v2`. Pedido do usuário: "mais UI/UX bonitinho": o mapa de grafos (Cytoscape) é uma ferramenta de **conferência** e ficou "cru, quadradão". No portal, a peça central **não é o grafo do código**, e sim **a rota e o que acontece nela**.

**Decisões (tomadas sem perguntar, registradas aqui):**
- **Autenticação do CI: token por projeto** (`sdci_...`). O dono cria no portal, o valor aparece **uma vez só** e o banco guarda só o hash, como os tokens da extensão. O token só publica em repositórios do próprio projeto (o remote é conferido). Pode ser revogado.
- **O que vai para o servidor:** o `ChaosResults` (que agora carrega também a **superfície de ataque**) e os metadados do git (commit, branch, PR, link do job). **Nenhum código-fonte**, só os mesmos fatos que a IA já pode ver: rotas, operações, tabelas, hosts e `arquivo:linha`.
- **Retenção:** as últimas **100 execuções por repositório**; as mais velhas saem na hora de gravar uma nova.
- **Publicar nunca muda o portão:** o envio é um passo separado no CI, com `continue-on-error`. Portal fora do ar não deixa o PR vermelho.

**Peças:**
- **CLI:** `shieldepy publish <pasta> --portal <url>` (token em `SHIELDEPY_PORTAL_TOKEN`). Lê o `.shieldepy/chaos-results.json`, o remote e o commit pelo git, e o PR e o link do job pelas variáveis do GitHub Actions. Devolve o link da execução no portal e, com `--append-link <relatório.md>`, acrescenta esse link ao relatório do PR.
- **Servidor:** tabelas `project_ci_tokens` e `chaos_runs`.
  - Rotas para o dono gerenciar os tokens (`/api/projects/:id/ci-tokens`).
  - O envio do CI (`POST /api/ci/chaos-runs`).
  - A visão do projeto (`/api/projects/:id/chaos`) e a execução completa (`/api/projects/:id/chaos/runs/:runId`).
- **Portal (React):**
  - **Página do projeto:** um painel "Caos no CI" com um cartão por repositório (status da última execução, branch e PR, contagens, e uma faixa com as últimas execuções em verde e vermelho) e um painel "Integração com o CI" (tokens e o passo a passo).
  - **Página da execução** (`/projects/:id/runs/:runId`): status em destaque, métricas, o escopo do PR e **cada rota como uma linha do tempo das operações** (`lê stock → chama api.stripe.com → grava stock → grava orders`). O alvo de cada falha fica marcado na operação, com a severidade, a invariante violada e o arquivo do teste. Também traz as tags, as hipóteses sem teste e o histórico do repositório.
- **Workflow e template:** um passo "Publicar no portal" quando há `SHIELDEPY_PORTAL_TOKEN` (secret) e `SHIELDEPY_PORTAL_URL` (variável).

**Tarefas:** **V3a** contrato + CLI `publish` ✅ · **V3b** servidor (banco, tokens, rotas, testes) ✅ · **V3c** portal: página do projeto e tokens ✅ · **V3d** portal: página da execução (a linha do tempo) ✅ · **V3e** CI e template, conferência visual (screenshots com sessão real) e docs ✅.

**Aceitação:** o `chaos` no vulnerável seguido do `publish` para um portal local → o projeto mostra o repositório **bloqueado**, e a página da execução mostra o `POST /checkout` com os 4 achados nas operações certas. Um token de outro projeto, ou um remote fora do projeto → 403.

**Aceitação do V2:**
- `chaos examples/checkout-express --offline --html` → `POST /checkout` em vermelho, com os 4 achados na lista. No `-fixed`, em verde.
- `diff --base` com o corpo do `StripeGateway.charge` mudado → o método marcado como `changed` e o `POST /checkout` como rota tocada.
- Na extensão, rodar o `chaos` pela CLI atualiza o painel aberto sem recarregar.

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

**Recomendação:** fazer **depois da E2 em TS**, quando o pipeline estiver provado de ponta a ponta. Ordem sugerida: Java/Spring (melhor retorno; stack comum em empresas) → C#/ASP.NET → Python. Fica como **E6 — outras linguagens** (era a E5; renumerada em 2026-10-08).

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

## E5 — mapa incremental e custo (escrito em 2026-10-08, antes de começar)

> Branch `feat/mapa-incremental`, empilhada sobre a `feat/chaos-gate` (E4). Vem de uma revisão de quatro propostas de custo (roteamento de modelos, sanitização de logs, cache de prompt e Batch API) e de uma nota sobre diff de grafos. Esta seção registra o que foi conferido e o que entra.

### O que foi conferido (na referência oficial de preços e no código)
1. **Roteamento de modelos.** A ideia vale, e o mecanismo já existe (tiers `fast`/`deep` e `SHIELDEPY_DEEP_MODEL`).
   - Correções: "Haiku 5.5" não existe (o atual é o **Haiku 4.5**, a US$ 1/5), e não há tarifa especial abaixo de 100k tokens.
   - O Sonnet 5.5 (US$ 2/10) custa o **dobro** do Haiku, não 5×. A economia de "mais de 80%" não fecha: no máximo 50% por token, e menos no total, porque o Threat Modeler ficaria no Sonnet.
   - São 6 **falhas** no catálogo e 2 especialistas no MVP, não 6 agentes.
   - Não há "ameaça humana": as falhas injetadas são de infraestrutura, e quem executa é o Vitest com o MSW. A IA só preenche specs.
   - Pendente desde a E3: o `deep` também serve ao chat e à revisão da extensão. Trocar o padrão para o Sonnet 5.5 só depois de medir (5e).
2. **Sanitização de logs:** já está feita, e de forma mais rígida (4a/4c). A IA nunca recebe log nem stack trace, só a invariante violada (1ª linha, limpa) e as operações com `arquivo:linha`.
3. **Cache de prompt.**
   - Leitura a 0,1× (o "até 90%" está certo); escrita a 1,25× (TTL de 5 min) ou 2× (1 h).
   - **Achado:** o `cacheSystem` está ligado no Threat Modeler (~600 tokens de sistema) e nos especialistas (~300), mas o mínimo cacheável é de **4096 tokens no Haiku 4.5** (512 no Sonnet 5.5). Hoje **o cache nunca é ativado**, sem erro e sem custo.
   - No Sonnet 5.5, o Threat Modeler passaria do mínimo, mas ele é chamado uma vez por execução.
   - Encher o prompt (ex.: ISO 27002) só para cachear aumentaria o custo.
4. **Batch API:** 50% sobre todos os tokens (acumula com o cache). Costuma terminar em menos de 1 h, com até 24 h. **Não serve para o portão do PR**, porque o PR espera e o pipeline tem 3 rodadas em sequência. Serve para uma rodada noturna do repositório inteiro (fica para depois).
5. **Diff de grafos.**
   - **Achado:** o id de símbolo inclui a linha (`src/services/CheckoutService.ts#checkout:23`, de `extract-ts.ts`). Inserir uma linha acima muda o id, e um diff entre versões sairia todo ruidoso.
   - Precisa de identidade estável, de detecção de renomeação (hash do corpo) e de diff como **operação de conjunto** sobre chaves estáveis (sem isomorfismo de grafo).
   - Precisão em JS dinâmico: a política já existe (o que não se prova sai `heuristic` e é contado).

### Desenho
- **Id estável de símbolo:** `arquivo#contêiner.nome`, sem a linha. A linha continua como atributo (para "abrir código" e `arquivo:linha`). Nomes repetidos no mesmo arquivo (callbacks inline iguais, sobrecargas) recebem um sufixo de ordem (`~2`, `~3`) pela ordem no arquivo.
- **Hash do corpo:** cada símbolo guarda um hash dos tokens da AST do corpo (sem comentários e espaços), e cada arquivo guarda o hash do seu código de topo (fora de símbolos). Mudou só o corpo → `changed`. Sumiu um nome e apareceu outro com o mesmo hash no mesmo arquivo → `renamed`.
- **Diff** (`diffSystemGraphs(base, head)`): símbolos `added/removed/renamed/changed`, arestas adicionadas e removidas, e arquivos com o código de topo alterado. Tudo por conjunto de chaves.
- **Rotas afetadas** (`affectedRoutes(baseTopo, headTopo, diff)`): a rota entra se
  - é nova ou mudou a cadeia de handlers;
  - suas operações ou tags mudaram;
  - algum símbolo do seu **alcance** (todo símbolo percorrido a partir dos handlers, não só os que fazem I/O) mudou, sumiu ou foi renomeado;
  - o código de topo de um arquivo desse alcance mudou (ex.: a montagem no `container.ts`).
  - **Conservador:** mudou o `shieldepy.chaos.config.ts`, um `setupFiles`, `package.json`, lockfile ou `tsconfig` → todas as rotas.
  - Para isso, a topologia passa a guardar o `reach` de cada rota (ids estáveis, ordenados).
- **Mapa base:** `--base <ref git>` monta o mapa da mesma pasta naquele ref, num `git worktree` temporário (só leitura de código; não precisa de `npm install`).

### Tarefas
- **5a. Ids estáveis.** ✅ Concluída em 2026-10-08. Id sem linha, com sufixo de ordem nos repetidos, e a linha como atributo. Migrar quem lê a linha do id (`surface.ts`, visualizador, extensão). Teste: inserir linhas no topo de um arquivo não muda nenhum id nem aresta (o `contentHash` muda, e deve mudar: o mapa guarda `startLine`).
- **5b. Hash do corpo e do topo do arquivo** ✅ Concluída em 2026-10-08, no mesmo parse (sem segundo parse). Teste: comentário e espaço não mudam o hash; mudar uma expressão muda.
- **5c. Diff.** ✅ Concluída em 2026-10-08. `diffSystemGraphs` e a CLI `shieldepy diff <pasta> --base <ref>` (texto e `--json`). Teste: renomear, mudar corpo, mudar topo e adicionar ou remover rota no `checkout-express` (em cópia temporária).
- **5d. Caos só no que o PR tocou.** ✅ Concluída em 2026-10-08. `reach` na topologia, `affectedRoutes` e `shieldepy chaos --base <ref>`: a superfície vai para a IA e para os testes só com as rotas afetadas. Nenhuma afetada → exit 0 e um relatório "nenhuma rota sensível tocada". A regra conservadora vale para config/deps. O relatório diz o que foi filtrado e por quê.
- **5e. Custo real.** Parte gratuita ✅ concluída em 2026-10-08. **Falta a medição paga**, que depende do usuário (ver o registro).
  - Medir com chamada paga (**só com autorização do usuário**): Threat Modeler no Sonnet 5.5 e no Haiku 4.5, especialistas no Haiku 4.5, nos dois exemplos. Registrar tokens, US$ e a qualidade das hipóteses.
  - Decidir o padrão do `deep` com esse dado. Separar o tier do caos do tier do chat, se for preciso.
  - Tirar ou documentar o `cacheSystem` onde o prompt fica abaixo do mínimo.
- **5g. Lotes no Threat Modeler.** ✅ Concluída em 2026-10-08, na branch `feat/visualizador-v2` (a ponta da pilha; ver o registro). Achado na estimativa de custo. Dividir a superfície em lotes de ~5 rotas, um Threat Modeler por lote em paralelo, com `max_tokens` proporcional ao lote. Hoje a saída estoura os 4000 tokens a partir de ~7 rotas de escrita (~5 com o raciocínio do Sonnet), e a IA perde a contribuição. O motor segue, sem perder teste.
- **5f. CI.** ✅ Concluída em 2026-10-08 (no repositório do ShielDepy, `--base` só quando o PR não mexe no motor; ver o registro). O workflow passa `--base` no PR (`fetch-depth: 0`, base = `origin/${{ github.base_ref }}`). O `self-test` continua com o mapa inteiro. Docs e template atualizados.

### Aceitação da E5
- Inserir linhas ou comentários num arquivo do `checkout-express` → diff vazio e nenhuma rota afetada → `chaos --base` sai 0 sem rodar teste.
- Mudar o corpo do `StripeGateway.charge` → só `POST /checkout` afetada; `GET /orders/:id` fica de fora.
- Renomear um método sem mudar o corpo → aparece como `renamed`, não como remoção mais adição.
- A medição de custo fica registrada no plano (se o usuário autorizar a chamada paga).

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
