# Plano — Chaos Engineering dirigida por Análise Estática (fatia vertical)

## Contexto
Hoje o ShielDepy só prova **colisões entre handlers de evento** (`Rule` → buckets `resource::event`) e **ciclos de chamada** (CodeGraph via Tree-sitter). Não há detecção de rotas HTTP nem de I/O (DB/API), não há export do grafo, não há LangGraph e não há `.github/`. O objetivo é o motor determinístico apontar as rotas sensíveis (`topology-graph.json`), um pipeline LangGraph gerar testes de caos **apenas** para essas rotas, executá-los com Vitest e bloquear o PR quando o código quebra sob falha física.

Decisões tomadas: **LangGraph.js em TS** (dentro de `packages/agent`, sobre o `LLMProvider` existente), alvo **Express + fetch/axios + pg/Prisma**, runner **Vitest** (+ supertest + MSW), entrega **ponta a ponta com `Network_Chaos_Agent` e `Concurrency_Agent`**; `DB_Chaos_Agent` fica para depois.

Princípio mantido do projeto: *o motor prova, a IA propõe*. Toda saída da IA é validada; sem chave de API existe caminho offline determinístico; um teste só conta como falha se passar no **run de controle** (sem caos).

**Ordem de entrega (ajuste pedido):** primeiro aperfeiçoar o mapeamento do sistema em grafos (Fase 0 + Fase 1), com métrica de cobertura e testes. Só depois disso, e com o grafo validado nos exemplos, entram os agentes (Fases 2–4). Cada marco é um PR separado.

## Como retomar num chat novo (atualizado em 2026-10-16, etapa L)

**Etapa atual (2026-10-16): L — motor por linguagem e C#**, na branch `feat/motor-linguagens`, criada a partir da `main` (`efa9b1d`, com tudo integrado). Leia a seção **"L — motor por linguagem e C#"** (decisão, desenho e tarefas L1–L6) e o fim do Registro. **O `CLAUDE.md` da raiz tem os combinados de trabalho** (vale em qualquer máquina).

**Decisão do usuário (2026-10-16), que substitui a de 2026-10-09 ("só JS/TS; Java e C# fora"):** a próxima linguagem é **C#**, depois **Python**. O motor continua nosso (Tree-sitter), sem o Graphify. O Graphify entra só como comparação no TCC: ele faz um grafo geral para a IA, sem chamadas em ordem com argumentos, sem tipo do receptor e sem rotas e I/O por framework.

**Onde paramos (2026-10-16), a pedido do usuário ("calma", "não começa"):**
- **L1 ✅** (o motor por linguagem), commitada (`f3c78d2`).
- **L2 ✅ (2026-10-16, pedido do usuário: "crie os adaptadores para C# e após isso Java")**: símbolos, namespaces e chamadas do C#, com o exemplo `examples/pedidos-aspnet`. Ver o registro de 2026-10-16. **L3 ✅** (rotas do ASP.NET Core) e **L4 ✅** (I/O do C#). **L5 ✅** (4 projetos C# reais) e **L6 ✅** (extensão; falta conferir num VS Code real). **A etapa L está completa.** **A etapa J (Java) também, em 2026-10-17** (J1–J6; ver a seção "J — Java no motor" e o registro). Falta, das duas: conferir a extensão num VS Code real (E2E) e subir a branch.
- Para a L2 foi lida a árvore do Tree-sitter de um controller ASP.NET de exemplo, que confirma os nós que o extrator usa:
  - `file_scoped_namespace_declaration` / `namespace_declaration`, `using_directive` (com `name_equals` no alias);
  - `class_declaration` com `bases: base_list` e `attribute_list`;
  - `field_declaration` → `variable_declaration` (`type`); `property_declaration`; `constructor_declaration` / `method_declaration` com `parameters`;
  - `invocation_expression` (`function`: `identifier` ou `member_access_expression` com `expression`/`name`); `object_creation_expression`; `this_expression` / `base_expression`;
  - `local_declaration_statement` com `implicit_type "var"`; `attribute` com `attribute_argument_list` (as rotas `[HttpGet("{id}")]`).
- Próximo passo, quando o usuário quiser: a L2 conforme o desenho abaixo.

**O que vem antes (etapa M e a integração), para contexto:**

**Etapa atual (2026-10-13): M — mapeamento em grafos nos projetos reais**, na branch `feat/mapa-projetos-reais`, criada a partir da `origin/main` (`60bf07a`, depois da C1 parcial). Pedido do usuário: "o foco agora é deixar 100% a parte de mapeamento em grafos", testando em apps Express do GitHub; depois, um plugin que só se instala e roda (mapeia o sistema e diagnostica). Leia a seção **"M — mapeamento em projetos reais"** (por que existe, os projetos, as tarefas M1–M6) e o fim do Registro.

**Estado ao fim de 2026-10-13:**
- M1–M6 commitadas na `feat/mapa-projetos-reais`, sem push. Suíte 357.
- Nos 12 projetos reais (`npm run mapa:reais`), nenhuma chamada fica sem alvo.
- **Falta, e depende do usuário:**
  - rodar o E2E num VS Code real (`npm run test:e2e -w shieldepy`);
  - abrir um projeto à mão para ver o aviso da M6;
  - subir a branch.
- **Próximos passos possíveis:**
  - injeção por contêiner (`typedi`/`Container.get`, o bulletproof);
  - Fastify/Koa (F1/F2);
  - Sequelize/Knex (F6);
  - o caos rodar nos projetos Mongoose/TypeORM: o contrato (C2) e a injeção de falha no banco, que hoje é só `pg`.

**Integração (2026-10-16):** a `main` passou a ter tudo: a linha R/Q/C1/M e a da E6 (DB_Chaos) com a demo do TCC (`feat/db-chaos` e `feat/demo-tcc`). Ver o fim do Registro. **Demo:** `npm run demo` (abre o VS Code com o plugin num sistema de exemplo) e `npm run demo:verificar` (confere o roteiro sem janela).

**Onde estávamos em 2026-10-09:** E1–E5, V1–V3, **R** (jornada do usuário e release) e **Q** (qualidade no projeto real) estão **todas mergeadas na `main`** (`03351c1`, PRs #1–#8). A etapa atual é a **C — caos utilizável**, na branch `feat/caos-utilizavel`, criada a partir da `main`. **A C1 parou no meio em 2026-10-09:** o último item do Registro diz o que foi feito e a ordem para retomar. Leia, nesta ordem:
1. esta seção;
2. a seção **"C — caos utilizável"**: por que existe, a ordem e as tarefas C1–C5, com o critério de pronto de cada uma;
3. as seções "Q" e "F", que a C usa;
4. o fim do **Registro**, para os detalhes do que já foi feito.

**O foco, nas palavras do usuário (2026-10-09):** "o negócio é o teste de caos". O mapa, os ciclos e as colisões são o apoio. Deixar o sistema utilizável é **fazer o caos rodar no projeto de quem instala**.

**Autorizado pelo usuário (2026-10-09):** clonar projetos **públicos** do GitHub numa pasta temporária **fora do repositório** (o scratchpad da sessão ou `%TEMP%`), para a C1. Não commitar nada clonado. Rodar `npm install` neles pode; não rodar scripts de `postinstall` de procedência duvidosa (use `npm install --ignore-scripts` quando der).

**Decisões de 2026-10-09 (do usuário):**
- **Só JS/TS por enquanto.** Python talvez depois; Java e C# saem do roadmap (a E6 vira "Python, talvez").
- **Modo local grátis:** sem conta, a extensão faz tudo o que é determinístico (ciclos, colisões, mapa, topologia, caos offline). A conta só traz o portal, a equipe e a política de IA da empresa.
- **O portal ainda não está publicado.** O release não pode depender dele.
- **Release:** primeiro `.vsix` nas GitHub Releases; o Marketplace fica para quando estabilizar. **O release espera a C2** (contrato quase automático), para a primeira impressão já ser "rodou sem eu escrever nada". A licença ainda não foi decidida: perguntar antes de publicar.

**Pendências antigas que continuam valendo:** o PR de teste do workflow no GitHub (o `shieldepy-chaos.yml` nunca rodou no Actions; virou a C4) e a medição paga da 5e (só com autorização).

**Combinados com o usuário (seguir sem perguntar):**
- Responder **em português**.
- Trabalhar **fatia por fatia** (D1, D2, ...): cada uma termina com testes passando, este plano atualizado (registro + ✅ na tarefa) e **um commit** no mesmo commit da mudança. Mensagem de commit em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Gastar com a API da IA (chamada paga) só com autorização explícita do usuário.**
- **Não fazer push nem abrir PR.** O usuário sobe a branch e faz o merge quando a etapa **inteira** estiver pronta. No fim, avisar e oferecer título e descrição do PR.
- Escolhas técnicas que surgirem: decidir, registrar no plano o porquê e avisar no resumo. Só perguntar o que for realmente do usuário (ex.: gastar dinheiro com chamada paga à IA, mexer no GitHub).
- **Nada de regex para ler código** (só Tree-sitter ou analisador léxico). Regex em texto da IA, em caminho de arquivo ou em texto que o app manda em tempo de execução pode.
- O princípio do projeto: **o motor prova, a IA propõe**. Toda saída da IA é validada, existe caminho offline, e um teste só conta como falha se o controle passou.
- Mudança visual (relatório, visualizador, portal): conferir em screenshot antes de dar por pronta. O roteiro do portal está no registro da V3c/V3d: banco temporário com `SHIELDEPY_DATA_DIR`, `chaos` + `publish` de verdade, screenshot pelo protocolo do Chrome com a sessão. Lembrar de **matar o servidor** no fim; no Windows o processo do tsx sobrevive ao fim do terminal.

**Como rodar (de `shieldepy_p1/`):**
- `npm run check`: typecheck + testes unitários (**325** no fim da etapa R, **355** na etapa M; nenhum pulado quando os exemplos têm `npm install`).
- `npm run mapa:reais [-- --so <id,...>] [--dir <pasta>] [--json <arquivo>]`: clona os 12 projetos reais da etapa M (commit fixo, fora do repositório, sem instalar nem executar nada deles) e imprime a tabela do mapa. Leva menos de 1 minuto depois de clonado.
- `npm run build:vscode`: dois arquivos. `dist/extension.js` tem ~640 KB; se crescer muito, algo puxou o LangGraph para dentro dele. O `dist/chaos.js` (~1,9 MB) é o pipeline de caos, carregado só pelo "Testar Caos".
- `npm run test:e2e -w shieldepy`: E2E num VS Code real (**33/33**, leva alguns minutos). O cenário do caos de verdade só roda com `npm install` em `examples/checkout-express`.
- `npm run package:vscode`: gera o `.vsix`. Para conferir o pacote, instale-o num `--extensions-dir` temporário e rode `SHIELDEPY_E2E_EXTENSION=<pasta instalada> node apps/vscode/test-e2e/run.mjs`.
- **Portal em desenvolvimento:** a extensão vem sem portal (`shieldepy.webBaseUrl` vazio, modo local). Para testar o login com o `npm run web`, ponha `"shieldepy.webBaseUrl": "http://localhost:3000"` nas settings.
- `npm run cli -- chaos examples/checkout-express --offline [--report chaos-report.md]`: gera e roda os testes de caos e aplica o portão (exit 1 no vulnerável e 0 no `-fixed`). Com `--no-run`, só gera.
- Dentro de um exemplo (`examples/checkout-express` e `-fixed`, que precisam de `npm install` próprio): `npm test` roda o teste de fumaça. Sem esse `npm install`, os testes da CLI e do agent que rodam o Vitest e o `tsc` dos exemplos são pulados.
- Atenção no Windows: os caminhos têm acento e espaço (`Área de Trabalho`), então use sempre aspas. Os arquivos do repositório estão em CRLF, e edições por script que procuram `\n` podem não casar; prefira o editor.
- `npm run cli -- diff <pasta> --base <ref>` e `npm run cli -- publish <pasta> --portal <url>`.
- `npm run estimate:chaos` (grátis) e `npm run measure:chaos -- --sim-gastar` (pago).
- `npm run demo` / `npm run demo:verificar`: a demo do TCC (sistema de exemplo fora do repositório, em `~/ShielDepy-demo`).
- Portal: `npm run web` (build + servidor). Para os testes, o banco vai para uma pasta temporária com `SHIELDEPY_DATA_DIR`.

**Ainda não feito, de propósito (não é bug):**
- Os modelos padrão (`fast` e `deep` = Haiku 4.5) não mudaram: falta a medição paga.
- `retry_storm` continua sem teste (o exemplo não tem retry). O DB_Chaos só injeta no `pg`: Prisma, TypeORM e Knex ficam sem teste, e falha no meio de transação também.
- A falha parcial em `stock` no corrigido sai **inválida** ("a falha não disparou"): o `stock` só é gravado depois da API no caminho de erro. É o comportamento esperado, não bug.
- Com 7 operações, a linha do tempo do portal rola na horizontal sem dica visual (observação da D5).
- Nenhum secret de IA ou de portal foi configurado no GitHub: o CI roda `--offline` e não publica.
- As observações do registro da 3a: 5 heurísticas e 2 sem alvo no `packages/` do próprio ShielDepy.

## Progresso e fluxo de trabalho

Este arquivo é atualizado a cada tarefa concluída, no mesmo commit da mudança. Cada etapa tem sua branch. **O merge na `main` é feito pelo usuário** quando a etapa inteira estiver completa.

- **Mergeados na `main`:** E1 (PR #1), V1 (PR #2), E2 (PR #3), E3 (PR #4), E4 (`feat/chaos-gate`), E5 com a 5g (`feat/mapa-incremental`, PR #5), V2 (PR #6) e V3 (PR #7), até o `297c964`.
- **Reordenações (decididas com o usuário):** em 2026-10-08, "outras linguagens" passou de E5 para E6, abrindo espaço para a E5 (mapa incremental e custo). No mesmo dia passou para **E7**, abrindo espaço para o **DB_Chaos (E6)**, a última falha do catálogo sem teste.
- **E6 — DB_Chaos: concluída** na branch `feat/db-chaos`, esperando o merge. Depois, a E7.

| Tarefa | Branch | Status |
|---|---|---|
| 1a–1d. E1: mapeamento em grafos (imports, chamadas, snapshot, extratores sem regex) | `feat/chaos-grafo` | concluído, mergeado |
| V1. Visualizador de conferência do mapa (`shieldepy graph --html`) | `feat/grafo-visualizador` | concluído, mergeado |
| 2. E2 / Fase 1: topologia (`topology-graph.json`, rotas, I/O, CLI `topology`), tarefas 2a–2f | `feat/topologia` | concluído, mergeado (PR #3) |
| V2. Visualizador de produto: resultados do caos e diff do PR no mapa (CLI e extensão), tarefas V2a–V2e | `feat/visualizador-v2` | concluído, mergeado (PR #6) |
| V3. Portal: resultados do caos enviados pelo CI e mostrados no `apps/frontend`, tarefas V3a–V3e | `feat/portal-v3` | concluído, mergeado (PR #7) |
| 3. E3 / Fases 2–3: LangGraph + agentes (tarefas 3a–3f, ver "E3 — contexto") | `feat/chaos-agentes` | concluído, mergeado (PR #4) |
| 4. E4 / Fase 4: execução, gate, GitHub Actions (tarefas 4a–4e, ver "E4 — contexto") | `feat/chaos-gate` | concluído, mergeado (junto do PR #6); falta o PR de teste no GitHub |
| 5. E5: mapa incremental e custo (ids estáveis, diff de mapas, caos só no que o PR tocou, medição de custo), tarefas 5a–5f | `feat/mapa-incremental` | mergeado (junto do PR #6); falta a medição paga (5e) |
| R. Jornada do usuário e release da extensão (modo local, primeiros passos, caos no editor, `.vsix`), tarefas R1–R4 | `feat/jornada-release` | concluído, mergeado (PR #8); falta publicar o release |
| Q. Qualidade no projeto real (minificados e pastas de terceiros, ciclo só com prova, recursão leve), tarefas Q1–Q3 | `feat/qualidade-mapa` (sobre a `feat/jornada-release`) | concluído, mergeado (PR #8) |
| C. Caos utilizável: validação em projetos reais, contrato quase automático, F, CI de verdade, release; tarefas C1–C5 | `feat/caos-utilizavel` | C1 parcial mergeada (PR #9); os testes das correções entraram na M; faltam o `--init` e rodar o caos nos projetos reais |
| M. Mapeamento em grafos nos projetos reais (CommonJS, Mongoose, `router.route()`, montagem em laço, decorators, mais projetos medidos), tarefas M1–M6 | `feat/mapa-projetos-reais` | M1–M6 ✅, integrada à `main` em 2026-10-16; falta conferir a M6 num VS Code real |
| F. Rotas e I/O do resto de JS/TS (Fastify, NestJS, Next.js, Koa, `node:http`; TypeORM, Mongoose, Sequelize, Drizzle, mysql2, SQLite…), tarefas F1–F7 | dentro da C (C3) | pendente; 3 a 5 semanas no total |
| 6. E6: grafo de chamadas para Python (Java e C# saíram do roadmap em 2026-10-09) | a definir | talvez, depois do release |
| E6. **DB_Chaos** (falha do banco depois da chamada externa), tarefas D1–D6 | `feat/db-chaos` | concluído, integrado à `main` em 2026-10-16 |
| Demo do TCC (`npm run demo`, botões "Ver grafo" e "Rodar testes de caos") | `feat/demo-tcc` | concluído, integrado à `main` em 2026-10-16 |
| L. Motor por linguagem e C# (frontend por linguagem, namespaces, ASP.NET Core, EF Core), tarefas L1–L6 | `feat/motor-linguagens` | concluído (L1–L6) |
| J. Java no motor (Spring Boot: rotas, Spring Data, JdbcTemplate, clientes HTTP), tarefas J1–J6 | `feat/motor-linguagens` | concluído (J1–J6); falta o E2E num VS Code real |

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
- 2026-10-08: **E4, E5 (com a 5g), V2 e V3 mergeados pelo usuário** (PRs #5–#7, `main` em `297c964`).
  - **Validação do que estava só no papel:**
    - pela API pública do GitHub, o workflow rodou nos três PRs e no push da `main`, e tudo passou: `chaos-gate`, `self-test` (o vulnerável barrado no Linux do GitHub) e `check` (a suíte com os exemplos instalados);
    - "Publicar no portal" ficou `skipped` (sem token);
    - o bot comentou o relatório no PR #7, com um comentário só (o `--edit-last` funciona);
    - E2E 27/27 na `main`.
  - **Falta (depende do usuário):** o PR de teste vermelho, a medição paga e o portal no ar. Tudo descrito em "Como retomar".
  - **Plano atualizado para a próxima etapa:** E6 — DB_Chaos ("outras linguagens" virou E7). Branch `feat/db-chaos` criada a partir da `main`.
  - **Achado ao desenhar o DB_Chaos:** o `checkout-express-fixed` também tem a falha parcial. Ele cobra e só depois grava o pedido; se o `insert` falhar, o cliente fica cobrado sem pedido e a reserva do estoque não volta. Isso vira a aceitação da E6.
- 2026-10-08: **D1 concluído (invariantes com contexto).**
  - Os testes gerados passam `ctx = { apiCalls }` a cada função de `invariants` (no controle e no caos). O tipo `ChaosInvariantContext` está no core, só como documentação: os projetos não importam o ShielDepy e copiam o formato no próprio config.
  - **Decisão (muda o desenho, que falava do `request:end` do MSW):** a chamada é registrada **dentro do handler saudável** do MSW, logo antes de devolver a resposta. Assim, só entra a chamada que **deu certo**; a que recebeu falha injetada (5xx, corpo inválido, atraso) não conta como cobrança. Com o `request:end`, um 503 do Stripe contaria como cobrança e o `noChargeWithoutOrder` acusaria o corrigido sem motivo. E não depende da ordem de eventos do MSW: quando o app recebe a resposta, a chamada já está na lista (a D3 usa isso para ligar a falha no banco).
  - `apiCalls` é zerado antes de cada teste (`beforeEach`, antes do `reset`).
  - Exemplos: `noChargeWithoutOrder(ctx?)` nos dois (cobranças `POST /v1/charges` − estornos `POST /v1/refunds` ≤ pedidos; sem contexto, `true`). Os testes de fumaça chamam os invariantes sem argumento e continuam passando.
  - Docs: o contrato no `docs/chaos-ci.md` (com o parágrafo do contexto), o README e o `CONFIG_TEMPLATE` da CLI.
  - Conferido: `chaos` no vulnerável continua com os 4 achados e o corrigido aguenta os 3; `npm test` e `tsc` nos dois exemplos; suíte **321** passando.
- 2026-10-08: **D2 + D3 concluídos (catálogo, spec, especialista e template do DB_Chaos)**, num commit só: o template tem que saber gerar a `DbSpec` para o código compilar.
  - **Catálogo:** `partial_failure_after_external_call` passa a `testable: true`, com uma restrição por alvo (`testableOn`): só quando a tabela é gravada via `pg`. Gravação via Prisma continua sem teste, com o motivo. Cada entrada ganhou o `untestedReason`, usado pela CLI, pelo relatório e pelo `chaos-results.json` (antes o texto estava repetido nos três).
  - **`DbSpec`:** `{ kind: 'db', target, op: any|insert|update|delete, error: connection|constraint|timeout, expect }`. O padrão do motor é `op: any`, `error: connection` e os invariantes nesta ordem: os `stateCheck` do projeto, `noUnhandledError`, `statusIn [502, 503, 504]` e `respondsWithin 6000`.
  - **Decisões (mudam o desenho):**
    - o estado vem **primeiro**, porque a primeira asserção que quebra é a que vai para o relatório. O achado que importa é "cobrou e não gravou" (`noChargeWithoutOrder`), não o 500 que veio junto;
    - `statusIn` sem o 500 do desenho (era `[500, 502, 503]`). O `noUnhandledError` já proíbe o 500, então ficou `[502, 503, 504]`, igual aos 5xx da rede.
  - **Validação do que a IA propõe:** o `op` só pode ser `any` ou um verbo que a rota de fato grava na tabela depois da primeira chamada externa (`dbOpsAfterApi`, lido da topologia); o especialista recebe essa lista como `writesAfterApi`. O `error` tem que estar no catálogo. O resto é descartado e registrado.
  - **Grafo:** o nó `db` entra no fan-out por `Send` (o agente `db_chaos` do catálogo vai para o nó `db`). Agora toda hipótese `testable` vira spec.
  - **Template `db`:**
    - troca o `query` do `Pool` e do `Client` do `pg` (os dois, e no `default` também), como o app os enxerga. Com o `vi.mock('pg')` do exemplo são as classes do PGlite; sem mock, as do `pg` de verdade. Ler um export que o mock não tem lança no Vitest, por isso a leitura fica num `try`;
    - a espiã liga quando há chamada saudável em `apiCalls` (D1) e falha a primeira gravação na tabela alvo com o erro no formato do `pg` (mensagem do Postgres e `code`: `ECONNRESET`, `23505` ou `57014`). Depois deixa passar tudo; só vale no bloco de caos;
    - o SQL é lido por palavras, sem regex. O primeiro verbo de gravação decide: `INSERT INTO t`, `UPDATE [ONLY] t` (menos `FOR UPDATE`/`DO UPDATE`), `DELETE FROM [ONLY] t`. Isso tira aspas e schema e aceita CTE (`WITH … UPDATE`).
  - **Decisão nova: "a falha não disparou" é inválido, não achado.** Se nenhuma gravação na tabela alvo acontece depois da API (ex.: o `release` do corrigido, que só roda no caminho de erro), o teste falha com uma mensagem que começa com `DB_NOT_FIRED`, e o runner da E4 classifica como **inválido**, com o motivo. O mesmo vale se o app não usar o `pg`.
  - **Achado no corrigido (a 1ª parte da D4, registrada antes de corrigir):** `chaos examples/checkout-express-fixed --offline` → **exit 1**:
    - **Crítico** em `partial_failure_after_external_call` / `orders`, com `stateCheck: noChargeWithoutOrder`. O `INSERT` do pedido falha depois da cobrança, nada é estornado e a exceção sobe: a requisição fica pendurada (o Express 4 não pega promise rejeitada) e o cliente fica cobrado sem pedido;
    - `stock`: inválido ("a falha não disparou"), porque o `stock` só é gravado depois da API no `release`;
    - continuam aguentando: corrida, 5xx e corpo inválido.
  - **Vulnerável:** 6 achados, os 4 de antes **mais** a falha parcial em `orders` e em `stock` (Crítico, `noChargeWithoutOrder`).
  - Testes: `specialists.test.ts` (spec padrão, validação do `op` e do `error`, `testableOn` com Prisma, o ramo `db` com IA), `templates.test.ts` (o arquivo gerado, e ele compila nos dois exemplos), `chaos-run.test.ts` (o "não disparou" vira inválido) e a aceitação da CLI com os números novos (o corrigido sai exit 1 até a D4). Suíte **326**.
- 2026-10-08: **D4 concluído (a compensação no corrigido).**
  - `PaymentGateway.refund(chargeId)`; o `StripeGateway` estorna com `POST /v1/refunds`, **com o mesmo timeout** (sem ele, o host voltaria a ter `no-timeout` e a hipótese de timeout reapareceria).
  - `CheckoutService.checkout`: se o `orders.insert` falha depois de cobrar, estorna, devolve a reserva e lança `OrderNotSavedError` (com `refunded`); o controller responde **502** `{ error: 'pedido não gravado', refunded }`. Estorno que falha não esconde o erro: sai `refunded: false`, para alguém reconciliar.
  - **Depois da compensação:** `chaos examples/checkout-express-fixed --offline` → **exit 0**: a falha parcial em `orders` aguenta (charges − refunds = 0 ≤ 0 pedidos, 502, estoque de volta), e a corrida, o 5xx e o corpo inválido continuam aguentando. O `stock` segue inválido ("a falha não disparou"), o que não conta no portão.
  - Topologia (teste da E2): o corrigido ganhou `api_call api.stripe.com refund` (com timeout) e um segundo `db_write stock release`; as tags não mudaram.
  - Fumaça: o corrigido ganhou "o banco cai no INSERT do pedido, depois da cobrança: 502, cobrança estornada e estoque de volta" (espiã no `Pool` do PGlite). No vulnerável **não** entrou o equivalente: lá o erro vira promise rejeitada sem tratamento (Express 4), e o Vitest derruba o `npm test` com "Unhandled Rejection". O teste de caos gerado já prova esse defeito.
  - Suíte **326**; `npm test` (5) e `tsc` no corrigido.
- 2026-10-08: **D5 concluído (superfícies, CI e custo).**
  - **CLI:** o texto e o JSON já serviam; a linha "sem teste" usa o `untestedReason` do catálogo.
  - **Relatório markdown:**
    - a seção virou "Hipóteses sem teste (não bloqueiam)";
    - o resumo do motor ganhou a frase da falha parcial ("a gravação em orders falha depois da chamada externa e nada é compensado");
    - o prompt do parágrafo da IA cita a correção típica (estornar a cobrança).
  - **Visualizador (achado pelo screenshot):** a rota pegava o pior status e "inválido" pesava mais que "aguentou". No corrigido, ela aparecia como `? POST /checkout` tracejada, com 4 testes aguentando e 1 inválido. **Decisão:** inválido não prova nada, então a rota só fica inválida quando nenhum teste dela valeu (ordem: achado > aguentou > inválido).
  - **Portal:**
    - o chip de inválido mostra o alvo ("Falha parcial em stock: inválido");
    - os hints das métricas mudaram: inválidos = "o controle falhou, ou a falha não disparou"; sem teste = "sem template, ou banco fora do pg";
    - **a falha parcial só marca a gravação.** Antes, a marcação era pelo nome da tabela, e a falha parcial em `stock` acendia também "lê stock" (achado no screenshot).
  - **CI:** o `self-test` exige também `partial_failure_after_external_call` em `orders` no relatório do vulnerável, e os comentários do workflow citam a compensação. YAML validado e o self-test simulado com o relatório real.
  - **Custo (`RELATORIO-CUSTO-IA.md`, estimativa grátis refeita):**
    - o script de estimativa ganhou a resposta do especialista `db` e os 6 achados do vulnerável;
    - vulnerável: 8 chamadas, **~US$ 0,017** no Haiku (era 0,012) e ~US$ 0,031 com o Threat Modeler no Sonnet;
    - 100 rotas sensíveis: US$ 0,70 a 1,08;
    - com `--base`, ~US$ 0,25 por mês;
    - a recomendação não mudou.
  - **Conferência visual (roteiro da V3):** portal num banco temporário, `chaos` + `publish` de verdade dos dois exemplos e screenshots pelo protocolo do Chrome com sessão, em desktop e celular.
    - **vulnerável:** "6 achados barraram este PR", com **"Falha parcial" na estação "grava orders"**; "lê stock" só com a Corrida;
    - **corrigido:** "O código aguentou todas as falhas injetadas", 4 aguentaram e 1 inválido, com o estorno e o segundo `release` na linha do tempo;
    - o visualizador (`--html`) foi conferido nos dois exemplos.
    - Servidor, Chrome headless e banco temporário desligados e apagados.
  - **Observação (não mexi):** com 7 operações, a linha do tempo do corrigido passa da largura no desktop e rola na horizontal (`overflow-x`, como no V3), sem uma dica visual de que há mais à direita. No celular, ela fica vertical e aparece inteira.
  - Suíte **326**.
- 2026-10-08: **D6 concluído, e com ele a E6 (DB_Chaos).**
  - **Docs:**
    - README: o especialista DB_Chaos no pipeline, um parágrafo do DB_Chaos (onde a falha é injetada, `ctx.apiCalls`, o "não disparou", só `pg`), os números novos dos exemplos e o limite reescrito;
    - `docs/chaos-ci.md`: a falha no banco na introdução e os limites (só `pg`, sem transação, o "não disparou", `retry_storm`).
  - **Aceitação (conferida):**
    - `chaos examples/checkout-express --offline` → **exit 1, 6 achados**: os 4 de antes e a falha parcial em `orders` e em `stock`, as duas Crítico, com `noChargeWithoutOrder` violada;
    - `chaos examples/checkout-express-fixed --offline` → **antes da compensação**, exit 1 com a falha parcial em `orders` (D2+D3); **depois** (D4), exit 0, com 4 aguentando e 1 inválido (`stock`, a falha não disparou);
    - os testes gerados compilam contra os dois exemplos;
    - suíte **326**, extensão com **636 KB** (sem mudança) e E2E **27/27** num VS Code real;
    - o portal mostra a falha parcial em "grava orders" (screenshots da D5);
    - o self-test do CI foi simulado com o relatório real. A execução no GitHub fica para depois do merge.
  - **Fica para o usuário:** subir a branch e fazer o merge; depois, o PR de teste sem a compensação (roteiro em "Como retomar").
- 2026-10-08: **Demo do TCC (`feat/demo-tcc`, a partir da `feat/db-chaos`).** O usuário parou a E7. Primeiro pensou em publicar no Vercel, mas desistiu: o que ele quer é clonar, rodar um comando e já apresentar o plugin.
  - **`npm run demo`** (`scripts/demo/demo.mjs`, Node puro, sem shell; funciona com acento e espaço no caminho):
    1. confere os pré-requisitos e instala e compila na primeira vez;
    2. cria `~/ShielDepy-demo/sistema-loja`, **fora do repositório** (pedido do usuário: o projeto não pode ganhar nada; `DEMO_DIR` muda o lugar, e uma marca `.shieldepy-demo` impede o `--do-zero` de apagar uma pasta que não seja da demo), com três partes: `checkout/` (o `checkout-express`), `pedidos/` (o `pedidos-microservices`, com colisões) e `relatorios/` (um ciclo), um repositório com as branches `main` (com defeitos) e `correcao` (o `src` do corrigido);
    3. sobe o portal num banco próprio (`scripts/demo/seed.ts` reaproveita o `seedDemo` e acrescenta o projeto, o token da extensão e o de CI);
    4. roda o caos nas duas branches e publica;
    5. abre o VS Code com `--extensionDevelopmentPath`, num perfil separado, com o `ROTEIRO.md` aberto em modo de leitura.
  - O `ROTEIRO.md` é o passo a passo por aba do plugin: Lista de erros, o ciclo, o mapa com o caos, a topologia, a correção (`git switch correcao` + `npm run caos`), "Comparar Mapa com uma Branch" e o portal.
  - **Na extensão:** `SHIELDEPY_DEMO_TOKEN` faz o login automático. Ele passa pelo `/api/me` como qualquer token, então não é atalho de acesso.
  - **Dois bugs da extensão que a demo revelou (corrigidos):**
    - o `reindexFromDisk` (observador de arquivos) não aplicava nem as pastas ignoradas nem o portão de repositório liberado. Os testes gerados em `.shieldepy/` entravam no grafo e poluíam o "Comparar Mapa", e arquivos de repositório não liberado podiam ser indexados;
    - o `IGNORED_SEGMENT` não tinha `.shieldepy`.
  - **Abrir o VS Code de dentro de outro VS Code:** o ambiente herda `ELECTRON_RUN_AS_NODE`, `VSCODE_ESM_ENTRYPOINT` etc., e o `Code.exe` novo sobe sem janela. O script tira todas as `VSCODE_*`, `ELECTRON_*` e `CHROME_CRASHPAD*`.
  - **Comparar Mapa:** compara desde o merge-base, como um PR. Por isso o roteiro manda estar na `correcao` e comparar com a `main` (o contrário dá zero mudanças).
  - **`npm run demo:verificar`:** percorre o roteiro num VS Code de teste (o do E2E), sem janela, e encerra tudo no fim, inclusive o portal (`taskkill /T` no Windows; matar só o pai deixava o servidor órfão). Passou nos 7 passos: login automático, grafo 100% provado (17 chamadas), as 2 colisões, o ciclo, o mapa com 6 achados, a correção com 0 achados e o mapa atualizando sozinho, e a comparação mostrando só a correção.
  - **Incidente:** a máquina do usuário deu **tela azul** durante os testes. Eu tinha deixado vários VS Code (alguns presos, sem janela), Chrome headless, VS Codes de teste e o portal rodando ao mesmo tempo, e encerrado processos à força. Daí em diante: uma coisa pesada por vez, sempre encerrada no fim.
  - Suíte **326**, E2E **27/27**; o README da raiz virou a porta de entrada da demo.
  - **Ajustes depois do primeiro teste do usuário:**
    - a demo mora **fora do repositório** (`~/ShielDepy-demo` ou `DEMO_DIR`);
    - abre numa **janela nova do VS Code já aberto** (`--extensionDevelopmentPath`, pelo CLI oficial `cli.js`). Uma instância com perfil separado não abria com a atualização do VS Code pendente;
    - o token da demo vai em `shieldepy.demoToken`, no `.vscode/settings.json` do sistema da demo, aceito só com portal em localhost.
- 2026-10-08: **A extensão no controle (pedido do usuário: "botão 1 para ver o grafo, botão 2 para rodar os testes e acusar os erros, com o grafo final").**
  - **Botões:** no painel do escudo, "◇ Ver grafo do sistema" e "⚡ Rodar testes de caos" (que vira "Rodando os testes de caos…" e fica desabilitado enquanto roda). Os mesmos dois aparecem como ícones no título do painel (`view/title`). Textos nos 4 idiomas do i18n. Conferido em screenshot do CSS real.
  - **`shieldepy.runChaos`** (`ChaosController`):
    - roda o pipeline inteiro pela **CLI empacotada junto da extensão** (`dist/shieldepy-cli.mjs`, um segundo build do esbuild, em ESM para o `defaultWasmDir` achar `<extensão>/wasm`; o banner dá `require`, `__dirname` e `__filename`). O LangGraph fica fora do `extension.js`, que continua com ~636 KB;
    - roda num processo à parte, com o Node do sistema (ou o do VS Code, com `ELECTRON_RUN_AS_NODE`), com progresso por etapa, cancelamento (`taskkill /T` no Windows) e o log na Saída → ShielDepy;
    - escolhe o projeto pelo `shieldepy.chaos.config.ts` (com mais de um, pergunta).
  - **Erros na linha certa:** `chaosToFindings` transforma cada teste que quebrou em achado (grupo novo `caos`, fonte "ShielDepy (caos)"), na operação atingida, lida da topologia que vem no `chaos-results.json`:
    - corrida: a escrita na tabela;
    - falha parcial: a gravação depois da API;
    - rede: a chamada à API.

    O teste que provou a falha e a rota vão como pontos relacionados. Um resultado que já esteja no disco (CLI, CI) também é publicado, e o observador do arquivo mantém tudo em dia.
  - **O grafo final** abre sozinho no fim da rodada (o painel do mapa já lia o `chaos-results.json` desde a V2).
  - **Bug de Windows achado e corrigido:** o VS Code entrega o caminho com o drive em minúscula (`c:\...`), e o Node resolve o `node_modules` com `C:\...`. Com isso, o Vitest carregava duas cópias de si mesmo e nenhum teste rodava ("Vitest failed to find the current suite"). A rodada usa o caminho real do disco (`realpathSync.native`), e a leitura do resultado continua com o caminho do VS Code, para não duplicar achados.
  - **Demo:** abre **sem resultado de caos** (quem roda é o botão, na frente da banca). O histórico do portal continua sendo gerado (`--sem-historico` pula essa parte). O `ROTEIRO.md` foi reescrito em torno dos botões. O `demo:verificar` percorre o roteiro pelos comandos dos botões: os 6 passos passam, incluindo 6 falhas, a falha parcial como erro no Problems em `OrderRepository.ts:14`, a `correcao` com 0 falhas e os erros de caos sumindo.
  - Suíte **329** (3 novos em `apps/vscode/test/chaos.test.ts`), E2E **27/27**.
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
- 2026-10-09: **C1 em andamento (parada no meio, a pedido do usuário). Feito até aqui: o motor nos 3 projetos, antes de instalar dependências.**
  - **Projetos escolhidos** (clonados no scratchpad da sessão, fora do repositório; num chat novo, clone de novo):
    - `gothinkster/node-express-realworld-example-app` (`30b68e1`): TS, Prisma 4, Express 4, 39 arquivos. O tamanho "médio".
    - `prisma/prisma-examples`, pasta `orm/express` (`caa902a`, sparse checkout): TS, **Prisma 7** com `@prisma/adapter-pg`, Express 5, 3 arquivos.
    - `manfraio/rest_api_with_nodejs_and_postgres` (`fdd9fc7`): **JS** (CommonJS), `pg` puro, Express 4, 6 arquivos. Achado pela busca da API do GitHub; os boilerplates JS maiores com Postgres usam Sequelize ou Knex (que a F6 cobre), por isso este.
  - **Medido antes das correções** (`graph` ~2 s em cada um, cobertura provada 100% nos três, 0 ciclos, 0 colisões, 0 ligações por palpite):

    | Projeto | Rotas | I/O | Causa |
    |---|---|---|---|
    | realworld | 20, **sem o prefixo `/api`** | **0** | `const prisma = global.prisma \|\| new PrismaClient()` ficava sem tipo; `Router().use(a).use(b)` e `export default Router().use('/api', api)` (roteador sem nome) não eram roteadores |
    | prisma 7 | 9 | **0** | o cliente vem de `../prisma/generated/client` (saída do `prisma generate`, que nem existe no clone), não de `@prisma/client` |
    | pgjs | **0** | (0) | `require('express').Router()` saía `unbound`; `app.use('/x', require('./routes/x'))` não virava montagem; SQL no formato `pool.query({ text: '...', values })` não era lido |

  - **Corrigido (todos baratos, no core; typecheck e os 330 testes passando):**
    1. `constructedType` (`ast.ts`): `a || new X()` e `a ?? new X()` (e parênteses) dão o tipo `X`. Pega o singleton de desenvolvimento do Prisma.
    2. `require('x')` como receptor: o `CallDesc` ganhou `spec`; o `resolveReturnMember` resolve `require('express').Router()` para o pacote e `require('./svc').f()` para o export do arquivo.
    3. `require('./r')` como argumento: o `CallArg` `call` ganhou `origin` (o `module.exports` do arquivo); o `routes.ts` monta por ele.
    4. Roteador sem nome: o `RawCall` ganhou `chainRoot`, a identidade de uma cadeia `X().a().b()`: a variável que a guarda, `default` no `export default`, ou `@linha:coluna` do começo dela. Vira o `receiverOrigin` do `CallSite`, e o `routes.ts` aceita receptor sem `object` quando há `receiverOrigin`.
    5. Argumento objeto: o `CallArg` `object` ganhou `texts` (chaves com texto literal); o `pgOperation` lê `query({ text })`.
    6. `classifySql`: na leitura, a tabela principal é a do 1º `FROM`/`JOIN` do nível de fora (`SELECT (SELECT ... FROM category) FROM product p` lê `product`, não `category`).
    7. Prisma 7: o `ModuleResolver` lê o `output` dos `generator` do `schema.prisma` mais próximo (na pasta ou em `prisma/`, subindo até o `package.json`) com um analisador léxico (`prismaGeneratorOutputs`), e import para dentro dessa pasta vira o pacote `@prisma/client`.
  - **Depois das correções:** realworld 20 rotas (com `/api`), 19 sensíveis, 30 operações; prisma 7 9 rotas, 9 sensíveis, 10 operações; pgjs 10 rotas, 10 sensíveis, 15 operações. Conferido à mão: `PUT /api/articles/:slug` (2 `findFirst`, o `update` do `disconnectArticlesTags` e o `update` final) e as rotas de `categories`/`products` do pgjs.
  - **Para retomar a C1, nesta ordem:**
    1. **Testes das correções** em `packages/core/test/real-project.test.ts`, um por item acima (ainda não escritos; só o teste de argumentos em `call-resolution.test.ts` foi ajustado para o `texts`). Conferir também o `GET /` do realworld: a cadeia mostra `express.static()` como middleware, que está certo.
    2. Itens 3 e 4 da tabela da C1: conferir rotas à mão num recorte e rodar o `npm run cli -- chaos <pasta> --init` nos três (pendências, o que o mapa errou).
    3. Itens 5 e 6: `npm install --ignore-scripts` em cada um, deixar o contrato rodando (banco: PGlite para o `pg`; para o Prisma, ver se dá SQLite ou PGlite com adapter; no Prisma 7 rodar o `prisma generate` e conferir se os arquivos gerados entram no mapa como ruído), depois `chaos --offline --report` e abrir os testes para julgar os achados.
    4. Fechar a tabela da C1 aqui e a lista ordenada para a C2.
  - Script de depuração usado (não versionado): um `.mts` rodado com `node --import tsx` que indexa a pasta e imprime `graph.callSitesIn(arquivo)` (nome, `outcome`, `package`, `receiverOrigin`, argumentos). Útil para achar a causa de rota ou I/O faltando.
- 2026-10-13: **Etapa M aberta** (branch `feat/mapa-projetos-reais`, a partir da `origin/main` `60bf07a`). Antes, conferido que o chat estava na `feat/demo-tcc`, que é outra linha (ver "Como retomar").
- 2026-10-13: **M1 concluída (CommonJS e Mongoose no grafo).** Medido em 6 projetos (tabela na seção M). As causas, todas no core:
  1. **Valor que sai de uma chamada:** `const app = express()` / `module.exports = mongoose.model(...)` / `export default Router()`. O `extractValueCalls` (`extract-ts.ts`) guarda a chamada que produz cada valor do topo (com os argumentos), no `ModuleInfo` do `CodeGraph` (`valueCalls`). O `resolveMemberOfLocal` resolve `app.listen()` pelo retorno dela, em qualquer arquivo que importe o valor. Uma pilha (`valueCallStack`) corta o laço entre dois arquivos que se exportam assim.
  2. **`require` de um valor único:** a ligação `const x = require()` ganhou `require: true`. Com `module.exports = app` no alvo, o que não for export com nome é membro do valor (`memberOfModule`). `module.exports = <chamada>` e `module.exports = new X()` agora viram o export `default`.
  3. **Construir ou chamar um valor de pacote** (`new User()` com `User = mongoose.model(...)`): é do pacote (`externalValue`).
  4. **Estáticos do Mongoose:** `mongoose.model(nome, schema)` procura primeiro em `schema.statics`. Para isso, os métodos de `userSchema.statics = { get() {} }` e de `userSchema.statics.isEmailTaken = function` ganharam o contêiner `userSchema.statics` (o mesmo vale para `Foo.prototype.bar = function`, que antes era função solta).
  5. **Barrel CommonJS:** `module.exports.userService = require('./user.service')` vira re-export do módulo inteiro (`imported: '*'`, `require: true`). Valia também para o ESM: `export * as svc from` seguido de `import { svc }` não resolvia `svc.f()`; agora resolve.
  - **Resultado:** `node-express-boilerplate` de 87,1% para 100% (205 chamadas provadas) e `express-rest-boilerplate` de 41,7% para 90,2% (os 4 por nome são métodos de instância, ver "Limitações" na seção M). Os 4 projetos em TS não mudaram. O mapa continua igual em qualquer ordem de indexação (conferido nos três maiores).
  - **Testes:** `packages/core/test/real-express.test.ts`, com os 7 padrões da C1 (que estavam sem teste, em 6 testes) e 5 testes da M1. Sem as correções, os 4 da M1 que dependem delas falham. Suíte **341** (+11), typecheck limpo.
- 2026-10-13: **M2 concluída (rotas que o mapa não lia).**
  - **`router.route('/x').get(a).patch(b)`:** os verbos da cadeia já resolviam para o express, com o `receiverOrigin` `@linha:coluna` do `router.route(...)`. O `findExpressRoutes` agora registra cada verbo no caminho da `.route()` e no roteador dela. `.route()` com caminho não literal vai para os "não deu para ler".
  - **Roteador por variável de `require`:** `const userRoutes = require('./user.route')` + `router.use('/users', userRoutes)` não montava. A C1 só tinha tratado o `require` direto no argumento. O `valueOrigin` segue o `module.exports = router` do alvo.
  - **Montagem em laço:** `defaultRoutes.forEach((route) => router.use(route.path, route.route))`.
    - O `ModuleInfo` guarda as listas literais de objetos do topo (`arrays`, só texto e nome).
    - A chamada dentro do callback de `lista.forEach/map` ganha `loop` (`RawCall` → `CallSite.loop`, com a origem da lista).
    - O `CodeGraph.arrayItems(origem)` devolve os itens com os nomes resolvidos, e o `routes.ts` faz uma chamada por item, trocando `route.path` e `route.route` pelos valores.
  - **Resultado:** `node-express-boilerplate` e `express-rest-boilerplate` passaram de 10 e 1 rotas (sem prefixo) para **15 e 15**, todas com `/v1/...` e a cadeia de middlewares do app, sem nenhum registro ilegível. Os projetos da C1 não mudaram (20, 9 e 10 rotas).
  - Suíte **344** (+3 em `real-express.test.ts`).
- 2026-10-13: **M3 concluída (Mongoose como I/O e handlers embrulhados).**
  - **O modelo no grafo** (`CallSite.model`): `modelOf` acha a chamada `mongoose.model('User', schema)` por trás do receptor nestes casos:
    - `User.findOne()`, inclusive importado por `require` ou barrel;
    - `this.findOne()` num estático ou método do schema (`schemaOf`, pelo contêiner `userSchema.statics`/`.methods`);
    - o documento: `new User(b).save()`, `const user = await User.findById(id)` e a cadeia `User.findOne(q).exec()`.
  - **Resolução:**
    - `this.x()` num estático vai para o estático do projeto ou para o pacote; antes, era palpite por nome.
    - `user.transform()` num documento vai para `userSchema.methods.transform`.
    - `schema.method({...})` e `schema.static({...})` também dão contêiner.
  - **Operações** (`io.ts`, `via: 'mongoose'`), com o nome do modelo como alvo (`dynamic` quando não dá para saber):
    - leitura: `find*`, `count*`, `exists`, `distinct` e `aggregate`;
    - escrita: `create`, `insertMany`, `save`, `update*`, `replaceOne`, `find*AndUpdate/Delete/Remove`, `delete*`, `remove` e `bulkWrite`;
    - transação: `startTransaction`/`commitTransaction`/`abortTransaction` contam; `withTransaction` só fica anotado.
  - **Handler embrulhado** (achado no caminho, era o motivo de 0 operações): `const createUser = catchAsync(async (req, res) => {})`.
    - O callback de dentro passa a se chamar `createUser` no grafo (`wrappedName`: declaração, `exports.x =` ou par de objeto). Antes, se chamava `catchAsync()`, e nada chegava nele.
    - Inline, `router.get('/', asyncHandler(async () => {}))`: o argumento-chamada carrega os callbacks (`CallArg.functions`), e o handler da rota é o de dentro (`asyncHandler(<inline>)`).
  - **Resultado:**
    - `node-express-boilerplate`: de 0 para **12 rotas sensíveis e 29 operações**, com `read-then-write` em `User` e `Token`;
    - `express-rest-boilerplate`: de 0 para **7 e 10**;
    - os projetos da C1 não mudaram.
  - Suíte **346** (+2).
- 2026-10-13: **M5a: mais 5 projetos medidos e o que eles mostraram.** Os novos: `sahat/hackathon-starter`, `santiq/bulletproof-nodejs`, `bradtraversy/proshop-v2`, `bezkoder/node-js-jwt-auth-mongodb` e `adrianhajdin/project_mern_memories` (o `microsoft/TypeScript-Node-Starter` não existe mais). Correções:
  1. **Rotas num parâmetro sem tipo:** `module.exports = function (app) { app.post(...) }` chamado com `require('./app/routes/auth.routes')(app)` (o bezkoder dava 1 rota de 7).
     - O `RawCall` ganhou `module` (a chamada `require('./x')(...)`, que antes nem era registrada) e `receiverParam` (o receptor é o parâmetro *n* do chamador).
     - O `routes.ts` (`routesOnParams`) trata cada chamada da função como uma **montagem sem prefixo** do roteador passado, na posição da chamada. Os middlewares do app registrados antes dela valem.
     - Parâmetro que nenhum chamador liga a um roteador do express não vira rota.
  2. **Middlewares em lista:** `post('/x', [auth, validate], ctrl)`. O `CallArg` ganhou `array`, e a cadeia de handlers achata a lista.
  3. **Objeto de modelos montado por atribuição** (`models/index.js` com `db.user = require('./user.model')`) e **apelido do topo** (`const User = db.user`): o `ModuleInfo` ganhou `objectRequires` e `aliases`, seguidos na resolução, no `valueOrigin` e no modelo do Mongoose.
     - Um apelido do topo deixou de ser "variável local sem tipo" na extração.
     - O arquivo com `objectRequires` religa quem o importa, como um barrel.
  4. **`const user = new User(b); user.save()`** com o modelo importado direto: o receptor tem o "tipo" `User`, que é um valor de pacote e não uma classe. Antes dava "nativo"; agora é do pacote, com o modelo.
  5. **Mapa dependente da ordem de indexação** (achado no `project_mern_memories`; existia antes): um `.css` "gerado" (uma linha com SVG embutido) importado por `import './index.css'` ficava ou não no mapa conforme a ordem. Agora vira nó provisório quando alguém o importa, nas duas ordens.
  - **Tabela (11 projetos), depois da M5a:**

    | Projeto | Provadas | Por nome | Sem alvo | Rotas | Sensíveis | Operações |
    |---|---|---|---|---|---|---|
    | realworld (TS, Prisma) | 100% | 0 | 0 | 20 | 19 | 30 |
    | prisma-examples express (Prisma 7) | 100% | 0 | 0 | 9 | 9 | 10 |
    | rest_api pg (JS) | 100% | 0 | 0 | 10 | 10 | 15 |
    | node-express-boilerplate (CJS, Mongoose) | 100% | 0 | 0 | 15 | 12 | 29 |
    | express-rest-boilerplate (CJS, Mongoose) | 91,3% | 4 | 0 | 15 | 8 | 11 |
    | express-typescript-boilerplate (TypeORM, decorators) | 97,7% | 3 | 0 | **0** | 0 | 0 |
    | hackathon-starter (CJS, Mongoose) | **70,9%** | 173 | 0 | 103 | 41 | 80 |
    | bulletproof-nodejs (TS, typedi) | 100% | 0 | 0 | 4 | **0** | 0 |
    | proshop-v2 (ESM, Mongoose, React) | **31,9%** | 9 | 38 | 26 | 21 | 52 |
    | jwt-auth-mongodb do bezkoder (CJS) | 100% | 0 | 0 | 7 | 2 | 4 |
    | mern-memories (ESM, Mongoose, React) | 100% | 0 | 0 | 6 | 6 | 7 |

    O que ainda falta: o frontend React do proshop (38 sem alvo), os testes do hackathon (173 por nome), os decorators do tsboiler (M4) e a injeção por contêiner do bulletproof (`Container.get(Service)` e `@Inject('userModel')`).
  - Suíte **350** (+4), todas as 4 falham sem as correções.
- 2026-10-13: **M5b: o resto do proshop e do hackathon-starter.**
  1. **Desestruturação no topo vira apelido de membro:** `export const { useGetOrderQuery, usePayOrderMutation: usePay } = orderApiSlice` e `const { logout } = authSlice.actions` (Redux Toolkit). Os nomes viram export e apelido (`X.chave`).
     - O `aliasedCall` resolve o apelido chamado direto, chamado com membro e importado de outro arquivo, e chega ao `@reduxjs/toolkit` pelo valor de `createApi`/`createSlice`.
     - Resultado: proshop de 31,9% para **79,5%**, sem nenhuma chamada sem alvo.
  2. **Hooks e `method/static` por chamada no schema:** `userSchema.pre('save', function clearExpired() {...})` dá contêiner `userSchema.hooks` (o `this` é o documento), e `userSchema.method('x', fn)` / `.static('x', fn)` dão `.methods` / `.statics`.
     - Só vale com o receptor declarado no arquivo como `new mongoose.Schema(...)` / `new Schema(...)` / `mongoose.Schema(...)`: `router.post('/x', fn)` tem a mesma forma de `schema.post('save', fn)` (teste de regressão incluído).
     - **`this.constructor.hashIP()`** num método ou hook é o estático do modelo.
  3. **`let ctrl; ... ctrl = require('../controllers/user')`** (testes que recarregam o módulo) vira import do arquivo.
     - Resultado: hackathon de 70,9% para **92,8%** (576 provadas).
     - As 45 por nome que sobram: `req.flash`/`req.logout`/`req.user.x()` (o passport e um middleware põem no `req` em tempo de execução), mocks do sinon e o parâmetro `builder` do Redux. Ficam por nome, marcadas, porque não há como provar estaticamente.
  - O mapa continua igual em qualquer ordem de indexação nos 10 projetos conferidos.
  - Suíte **353** (+3).
- 2026-10-13: **M4 concluída (rotas por decorator e TypeORM como I/O).**
  - **Decorators:** a chamada de um decorator ganhou `decorates` (o símbolo decorado).
    - Decorator de classe antes ou depois do `export` vale para a classe.
    - Decorator de método fica antes do método, como irmão no `class_body`.
  - **Rotas** (`decoratorRoutes`, em `routes.ts`), para `routing-controllers` e `@nestjs/common`:
    - `@Controller('cats')` / `@JsonController('/pets')` / `@Controller({ path })` na classe dão o prefixo;
    - `@Get/@Post/@Put/@Patch/@Delete/@Head/@Options/@All` no método dão o verbo e o caminho, e o handler é o próprio método;
    - `app.setGlobalPrefix('api')` literal entra; o `routePrefix` do `routing-controllers` vindo de variável de ambiente, não;
    - método com verbo numa classe sem `@Controller` não é rota.
  - **TypeORM** (`via: 'typeorm'`): a entidade é o alvo, lida do **argumento genérico**. O símbolo de classe ganhou `extendsArg` e `fieldArgs`, e o `CodeGraph.entityOf` olha:
    - o campo `private repo: Repository<User>` (padrão do Nest);
    - o repositório próprio `extends Repository<Pet>` (subindo pelas bases);
    - `getRepository(Pet)`. Para isso, a chamada que produz um receptor passou a levar os argumentos (`withArgs`).
  - **Operações do TypeORM:**
    - leitura: `find*`, `count*`, `exist*`, `sum/average/minimum/maximum`;
    - escrita: `save`, `insert`, `update`, `upsert`, `delete`, `remove`, `soft*`, `restore`, `increment/decrement`, `clear`;
    - SQL cru: `query('...')`, classificado pelo analisador léxico;
    - transação: o `queryRunner` (`start/commit/rollbackTransaction`) conta; `transaction(cb)` só fica anotado.
  - **Resultado:**
    - `express-typescript-boilerplate` (routing-controllers + TypeORM): de 0 para **11 rotas, 10 sensíveis e 10 operações**;
    - `lujakob/nestjs-realworld-example-app` (NestJS + TypeORM, clonado agora): **21 rotas com `/api`, 20 sensíveis, 41 operações**, 100% das chamadas provadas, com `read-then-write` em `ArticleEntity`, `UserEntity`, `Comment` e `FollowsEntity`.
  - Suíte **355** (+2). A ajuda da CLI (`topology`) agora cita NestJS e `routing-controllers`.
  - **Ainda não coberto:** a injeção por contêiner do `typedi` sem tipo no construtor (`Container.get(AuthService)` e `@Inject('userModel') private userModel: Models.UserModel` do bulletproof); o `routePrefix` vindo do `.env`.
- 2026-10-13: **M5 concluída: `npm run mapa:reais`** (`scripts/measure-real-projects.ts`).
  - Os 12 projetos ficam **fixados num commit**.
  - O script clona por `git fetch --depth 1 origin <sha>` (com sparse checkout para o `prisma-examples`) numa pasta fora do repositório (padrão `<tmp>/shieldepy-mapa-reais`), sem instalar nem executar nada deles, mede um por vez e imprime a tabela em markdown (`--json` grava os números).
  - **Achado no caminho:** no Windows, uma pasta temporária funda estoura o limite de caminho ao gravar o pack do git. O script passa `core.longpaths=true`.
  - **Tabela final da etapa M** (saída do script):

    | Projeto | Pilha | Provadas | Por nome | Sem alvo | Rotas | Sensíveis | Operações |
    |---|---|---|---|---|---|---|---|
    | realworld | TS, Express, Prisma | 100% | 0 | 0 | 20 | 19 | 30 |
    | prisma-express | TS, Express 5, Prisma 7 | 100% | 0 | 0 | 9 | 9 | 10 |
    | pg-crud | JS (CJS), Express, pg | 100% | 0 | 0 | 10 | 10 | 15 |
    | node-express-boilerplate | JS (CJS), Express, Mongoose | 100% | 0 | 0 | 15 | 12 | 29 |
    | express-rest-boilerplate | JS (CJS), Express, Mongoose | 91,3% | 4 | 0 | 15 | 8 | 11 |
    | express-typescript-boilerplate | TS, routing-controllers, TypeORM | 97,7% | 3 | 0 | 11 | 10 | 10 |
    | hackathon-starter | JS (CJS), Express, Mongoose | 92,8% | 45 | 0 | 103 | 41 | 80 |
    | bulletproof-nodejs | TS, Express, typedi, Mongoose | 100% | 0 | 0 | 4 | 0 | 0 |
    | proshop-v2 | JS (ESM), Express, Mongoose, React | 79,5% | 9 | 0 | 26 | 21 | 52 |
    | jwt-auth-mongodb | JS (CJS), Express, Mongoose | 100% | 0 | 0 | 7 | 2 | 4 |
    | mern-memories | JS (ESM), Express, Mongoose, React | 100% | 0 | 0 | 6 | 6 | 7 |
    | nest-realworld | TS, NestJS, TypeORM | 100% | 0 | 0 | 21 | 20 | 41 |

    **Nenhuma chamada sem alvo** nos 12. As chamadas por nome que sobram são de valores postos em tempo de execução (`req.flash`, `req.logout`, `req.user`), parâmetros de callback (`builder` do Redux, `.then((u) => ...)`) e mocks do sinon. O único projeto sem operações é o bulletproof (contêiner do `typedi`).
- 2026-10-13: **Desempenho conferido.**
  - O `assignsRequire` da M5b varria o escopo a cada referência a `let x;`, o que é quadrático: o `test/user.test.js` do hackathon (2 mil linhas) levava 1,6 s. Agora é uma varredura por árvore (`WeakMap` pela `Tree`): 0,66 s, contra 0,62 s na `main` antes da etapa M.
  - O hackathon inteiro indexa em ~4,8 s (3,9 s na `main`). A topologia leva 0,3 s.
- 2026-10-13: **M6 concluída (o plugin conta o que mapeou e oferece o próximo passo).**
  - `summarizeMap` (`apps/vscode/src/workspace/mapSummary.ts`) monta a topologia uma vez, sem reindexar, e resume: arquivos, rotas, sensíveis, operações, % de chamadas provadas e as sem prova.
  - **Ao terminar a indexação inicial**, a extensão:
    - grava o resumo no log (`[mapa] ...`);
    - põe na dica da barra de status ("Mapa: 20 rota(s), 19 sensível(is), 100% das chamadas provadas");
    - **uma vez por projeto** (`workspaceState`), mostra o aviso "ShielDepy: 39 arquivo(s) mapeado(s): 20 rota(s), 19 sensível(is) a testar, 100% das chamadas provadas", com **Ver o mapa do sistema** e, se houver rota sensível, **Testar caos nas rotas**. Sem rota reconhecida, o aviso diz quais frameworks o mapa lê.
  - Nada disso roda no modo de teste (o E2E não muda). Textos nos 4 idiomas.
  - Com o walkthrough da R2, o fluxo de quem instala fica: abrir o projeto → o mapa sai sozinho, com o resumo → Ver o mapa / Testar caos.
  - Suíte **357** (+2 em `apps/vscode/test/mapSummary.test.ts`).
  - `dist/extension.js`: 672 KB (era ~640 KB, pelas regras novas do core; o LangGraph continua fora).
  - **Não conferido num VS Code real** (combinado de não abrir VS Code sem perguntar): falta rodar o E2E (`npm run test:e2e -w shieldepy`) e abrir um projeto à mão para ver o aviso.
- 2026-10-16: **Integração das duas linhas na `main`** (pedido do usuário: "que a main não tenha dúvidas").
  - A `feat/demo-tcc` (que contém a `feat/db-chaos`) entrou por merge na `feat/mapa-projetos-reais`, que já estava sobre a `main`.
  - **Conflitos e decisões:**
    1. **Conta:** fica o modo local da R1. Saíram o portão por login (`setPathGate`, `requireAccess`, o contexto `shieldepy.unlocked`) que a demo ainda tinha, por ter saído de uma base antiga. Ficou o `shieldepy.demoToken` da demo, que só entra com portal em localhost.
    2. **Caos:** havia duas implementações de `shieldepy.runChaos`.
       - Quem roda é o `ChaosCommand` da R3: contrato, pacotes, escopo e motor/IA, coberto pelo E2E.
       - O `ChaosController` da demo virou só o publicador do resultado: cada `chaos-results.json` vira erro na linha do código.
       - O `ChaosCommand` ganhou o evento de "rodando" (o botão do painel fica desabilitado) e o caminho real do disco (`realpathSync.native`), a correção de Windows da demo contra o Vitest duplicado.
       - Saíram a CLI empacotada à parte (`dist/shieldepy-cli.mjs`, `apps/cli/src/bundle-entry.ts`) e o comando duplicado no `package.json`.
    3. **Painel:** os botões "Ver grafo do sistema" e "Rodar testes de caos" da demo, mais o aviso de IA e o walkthrough da `main`. Os ícones do título do painel não dependem mais do login.
    4. **`npm run demo:verificar`:** chama `api.chaos.execute(<checkout>, { offline: true })`, o mesmo que o botão roda, sem as perguntas.
  - Suíte **365** (357 + os da E6 e da demo). O `build:vscode` passa (`extension.js` com 679 KB).
  - **Não conferido num VS Code real:** o E2E e o `demo:verificar`.
- 2026-10-16: **L2 concluída (C#: símbolos, namespaces e chamadas).** Pedido do usuário: "crie os adaptadores para C# e após isso Java".
  - **`extract-csharp.ts`** (só Tree-sitter): classes, structs e records (com o namespace), métodos, construtores (o nome é o da classe), funções locais e os callbacks de endpoint (`app.MapGet("/x", ...)`, em qualquer lugar) e de topo (Program.cs). Interface, enum e delegate não viram símbolo, como no TS.
  - **Receptor por tipo:** variável local tipada, `var x = new X()`, `var x = chamada()` (pelo retorno, com `Task<T>` desembrulhado), parâmetro (inclusive de lambda), campo e propriedade (`_repo.Save()` = `this._repo.Save()`), injeção pelo construtor (`_db = db;`), `this`/`base`, estático (`OrderService.Create()`), qualificado (`App.Util.Fmt.Do()`) e chamada sem receptor dentro da classe. `nameof` não é chamada; delegate em campo ou variável não é método.
  - **Atributos** viram chamadas `decorates`, como os decorators do TS (é o que a L3 usa para as rotas).
  - **Resolução por namespace (CodeGraph):**
    - o frontend devolve o `NamespaceScope` do arquivo: os namespaces visíveis (o próprio e os de cima, os `using`), os aliases (`using Svc = ...`) e os `global using`;
    - cada classe guarda o `namespace`, e o índice `typesNamed` (nome simples → classes) resolve um nome pelo que o arquivo enxerga: simples, qualificado (absoluto ou relativo a um visível) ou alias;
    - **religação:** quem resolveu um nome pelo índice fica em `typeDependents` e religa quando uma classe com esse nome entra, sai ou muda; um `global using` novo ou removido religa todo arquivo C#. Há teste de ordem de indexação.
    - `new X()` tem resolução própria (`RawCall.ctor`): o construtor de `X`, a classe sem construtor, o pacote ou nativo.
    - receptor qualificado: o tipo é o maior prefixo que resolve; o resto são membros (`OrderService.Instance.Do()`).
  - **Base × interface:** a 1ª base vira `extends` só se não for interface declarada no arquivo nem seguir a convenção `I` + maiúscula; todas entram em `implements`. A base é resolvida **sem** cair nas implementações (`resolveType(..., implementers = false)`, também para o TS, onde não muda nada: os 361 testes de antes passam).
  - **Tipos de fora** (`CSHARP_EXTERNAL_TYPES`): `DbContext`/`DbSet` → EF Core, `HttpClient` → `System.Net.Http`, `ControllerBase` e os atributos de rota → ASP.NET Core MVC, `WebApplication` → `Microsoft.AspNetCore.Builder`, `IEndpointRouteBuilder` → Routing, conexões ADO.NET (`IDbConnection`, Npgsql, SqlClient...). Viram ligações de import para o pacote, e os especificadores de um arquivo C# são sempre pacotes (`linkPackages`). O resto (BCL, LINQ, `ILogger`, `Results`) é nativo e não conta na cobertura.
  - `obj/` (saída de build do .NET) entrou nas pastas ignoradas.
  - **Exemplo `examples/pedidos-aspnet`:** o checkout do `checkout-express` em ASP.NET Core + EF Core, com os mesmos defeitos (corrida no estoque, falha parcial). No `graph`: 9 arquivos, **100% das chamadas provadas** (9 resolvidas, 17 para pacotes, nenhuma por nome nem sem alvo). As chamadas do EF Core saem com a entidade do `DbSet<T>` (`model=Order`).
  - **Limitações (anotadas, não são bug):**
    - construtor primário (`class X(IDep d)`, C# 12): a gramática do `tree-sitter-wasms` 0.1.13 não lê, e a classe sai com um nó de erro. Os parâmetros dele ficam sem tipo;
    - métodos de extensão do projeto (`order.Validate()` com `static void Validate(this Order o)`) ficam sem alvo; `using static` não abre membros;
    - partial class funciona (as partes são classes de mesmo nome), mas classe aninhada é procurada pelo nome simples no namespace de fora;
    - os tipos de fora são uma lista por nome: sem o compilador não há como saber o pacote de um tipo qualquer.
  - Suíte **372** (+11 em `packages/core/test/csharp.test.ts`).
- 2026-10-17: **J6 concluída (a extensão com Java) — a etapa J está completa.**
  - O grafo da extensão indexa `.java` (a gramática já vinha no `wasm/`), e as regras do `@EventListener` saem da mesma árvore (feito junto da J1).
  - Textos: o aviso "nenhuma rota reconhecida" cita o Spring (4 idiomas); o README da extensão, o walkthrough, o README do `shieldepy_p1` (com o passo a passo de "linguagem nova no mapa completo") e o da raiz dizem o que cada linguagem tem. O caos continua só JS/TS.
  - **Não conferido num VS Code real** (perguntar antes de abrir o VS Code ou rodar o E2E).
- 2026-10-17: **J5 concluída (4 projetos Java reais no `mapa:reais`).** Clonados fora do repositório, sem instalar nem executar nada.
  - **A 1ª medição deu 45–84% das chamadas provadas**, com centenas sem alvo. Quase tudo era uma coisa só:
    1. **`import static`** (`assertThat`, `status()`, `given`, `joining`): a chamada sem receptor ia para a própria classe. Agora o frontend guarda os imports estáticos (`RawCall.statics`): sem alvo na classe, o grafo tenta a classe do import (do projeto → provado; de fora → nativo). `import static x.Y.*;` tenta cada uma.
    2. **Classe anônima** (`new HashMap<>() {{ put(...) }}`): o `put` é da base da anônima, não da classe de fora.
    3. **Métodos de `Object`** sem receptor (`getClass()`, `equals`) são nativos quando a classe não os declara.
  - **Tabela (2026-10-17):**

    | Projeto | Pilha | Arquivos | Provadas | Por nome | Sem alvo | Rotas | Sensíveis | Operações |
    |---|---|---|---|---|---|---|---|---|
    | petclinic | Java, Spring MVC, Spring Data JPA | 63 | 100% | 0 | 0 | 17 | 9 | 9 |
    | petclinic-rest | Java, Spring REST, JPA/JDBC/Spring Data | 109 | 100% | 0 | 0 | 1 | 0 | 0 |
    | spring-realworld | Java, Spring MVC, MyBatis | 116 | 100% | 0 | 0 | 19 | 2 | 2 |
    | petclinic-microservices | Java, Spring Cloud, WebClient, Spring Data | 90 | 100% | 0 | 0 | 16 | 13 | 19 |

  - **O que sobra (anotado, não é bug):**
    - petclinic-rest: as rotas estão em interfaces que o `openapi-generator` gera no build (em `target/`, fora do repositório); os controllers só as implementam. Sem o build, não há o que ler;
    - spring-realworld: o banco é MyBatis (`@Mapper` com SQL em XML), que o mapa ainda não lê como banco;
    - `@Transactional` abre a transação sem fechar (o que vem depois do método na mesma rota conta como dentro).
  - **Nada mudou no resto:** os 12 projetos JS/TS e os 4 C# deram os mesmos números.
  - Suíte **400** (+1).
- 2026-10-17: **J3 e J4 concluídas (I/O do Java e o exemplo `pedidos-springboot`).** Em `topology/io.ts`, pelo pacote para o qual a chamada resolveu.
  - **Spring Data** (`via: 'springdata'`): pelo nome do método, inclusive os derivados — `save*`/`delete*`/`remove*`/`insert*`/`update*` escrita, `find*`/`get*`/`read*`/`query*`/`search*`/`stream*`/`count*`/`exists*` leitura, outro nome (um `@Query` próprio) `db_unknown`; o alvo é a entidade do repositório (`extendsArg`). Só a chamada no próprio repositório conta (`repo.findAll().stream()` é uma leitura).
  - **JdbcTemplate/NamedParameterJdbcTemplate** (`via: 'jdbctemplate'`): o SQL literal do 1º argumento, pelo `classifySql` (com `FOR UPDATE`). **JdbcClient:** o SQL do `.sql("...")` da cadeia, contado no terminal (`list`/`single`/`update`...).
  - **EntityManager** (`via: 'jpa'`): `find(Order.class, id)` leitura da entidade (o `Order.class` chega como `constant`), `persist`/`merge`/`remove` escrita (`dynamic`: o tipo do objeto não se lê daqui), `createQuery`/`createNativeQuery` pelo SQL; `getTransaction().begin()/commit()/rollback()` como transação.
  - **`@Transactional`** no método: um `db_tx startTransaction` na entrada (a anotação é a 1ª chamada do método), então leitura e escrita lá dentro não saem `no-transaction`. Não há o fechamento: o que vier depois do método na mesma rota conta como dentro (anotado).
  - **Clientes HTTP:** `RestTemplate` (`getForObject`/`postForObject`/`exchange`..., host da URL) e `WebClient`/`RestClient` (o host vem do `.uri("...")` da cadeia; a operação é o `retrieve`/`exchange*`); `java.net.http.HttpClient.send` com host `dynamic`. Timeout `unknown` (é do cliente, configurado no builder).
  - **Correção no CodeGraph:** interface importada pelo nome qualificado (no Java, todo `import`) não caía nas implementações; agora cai, como a de nome simples.
  - **Exemplo `examples/pedidos-springboot`:** o checkout em Spring Boot + Spring Data JPA + Lombok + `RestTemplate`. `POST /api/checkout` sai com as mesmas tags do `checkout-express` e do `pedidos-aspnet` (`external-io`, `no-transaction` e `read-then-write` em `StockItem`, `write-after-api-call` em `Order` e `StockItem`), tudo `proven`, 100% das chamadas provadas.
  - Suíte **399** (+4).
- 2026-10-17: **J2 concluída (rotas do Spring MVC).** Em `topology/routes.ts`, pela regra de sempre (só conta a anotação que resolve para o pacote do Spring, `spring-web`).
  - `@RequestMapping` na classe dá os prefixos; no método, `@GetMapping`/`@PostMapping`/`@PutMapping`/`@PatchMapping`/`@DeleteMapping` ou `@RequestMapping(method = RequestMethod.X)` (sem `method`: `ALL`). O caminho vem do valor posicional ou de `value`/`path`, texto ou lista (`{"/a", "/b"}` vira duas rotas). Sem caminho, vale o da classe.
  - Os argumentos das anotações chegam pelo `CallArg` novo: `object.values` (os pares) e `constant` (`RequestMethod.PUT`).
  - Caminho não literal (`@GetMapping(P)`, com `P` constante) vai para `skipped`. Uma anotação `GetMapping` do próprio projeto não é rota.
  - Suíte **395** (+2).
- 2026-10-16: **J1 concluída (Java: símbolos, packages e chamadas).** `extract-java.ts`, só Tree-sitter, no mesmo molde do C#.
  - **Símbolos:** classes, records (os componentes são campos e acessores), enums (com `values`/`valueOf`/`name`/`ordinal`), métodos e construtores (o nome é o da classe); classe aninhada guarda as de fora. Interface comum e anotação não viram símbolo; **repositório do Spring Data vira** (estende um repositório do Spring, ou se chama `*Repository` e estende outro), sem os métodos declarados (o Spring os gera), com a base e a entidade no `extendsArg`.
  - **Resolução por package** (o `NamespaceScope` do C#): o próprio package e os `import x.*;` visíveis; `import x.y.Tipo;` é alias; `import static` fica de fora. Nome totalmente qualificado com raiz minúscula (`com.other.Fmt.go()`): se não é campo da classe, o grafo tenta a cadeia como tipo (`qualifiedMember`).
  - **Tipos de fora só pelo import** (`JAVA_EXTERNAL_TYPES`, com os prefixos): Spring Data, `JdbcTemplate`/`JdbcClient`, `EntityManager` (jakarta/javax), `RestTemplate`/`RestClient`, `WebClient`, `java.net.http.HttpClient`, as anotações de rota e o `@Transactional`. Uma classe `Repository` do projeto não é a do Spring.
  - **Receptor por tipo** como no C# (local, `var`, parâmetro, campo, `this`/`super`, estático, `new X()`), injeção por construtor (`this.repo = repo`) e por campo (`@Autowired`), referência a método (`this::tick`) como `references`. **Lombok** (`@Data`, `@Getter`, `@Setter`, `@Value`, `@Builder`): os acessores gerados são nativos, não "sem alvo".
  - **`Optional<T>`/`CompletableFuture<T>`/`Mono<T>`:** o retorno fica nativo (o método chamado logo depois é do embrulho: `find(id).orElseThrow()`), mas o método guarda o T (`unwraps`); `orElseThrow`/`orElse`/`get`/`join`/`block` devolvem T (`var o = find(id).orElseThrow(); o.validate()` liga).
  - Genéricos da biblioteca padrão (`List`, `Map`, `Stream`, `Page`...) qualificados em `java` (nativos), como os da BCL no C#. `target/` e `.gradle/` entraram nas pastas ignoradas.
  - **Regras do `@EventListener`:** com o `.java` no grafo, o `WorkspaceModel` as tira da árvore de Java do grafo (`extractJavaListeners`), como no TS e no C#; antes o registro lia o arquivo de novo.
  - Suíte **393** (+6 em `packages/core/test/java.test.ts`).
- 2026-10-16: **L5 concluída (4 projetos C# reais no `mapa:reais`).** Clonados fora do repositório (`--dir`), sem instalar nem executar nada deles (autorização de 2026-10-09).
  - **A 1ª medição, sem ajuste nenhum, já dava 95–98% das chamadas provadas**, mas a topologia mostrou o que faltava. Cada correção abaixo saiu de um caso real:
    1. **Gramática do C#.** A do `tree-sitter-wasms` 0.1.13 (a última dele) não lê lambda com tipo de retorno (C# 10: `async Task<Results<...>> (Db db) => ...`) nem construtor primário (C# 12): rotas do TodoApi sumiam num nó de erro. Agora o `wasm/tree-sitter-c_sharp.wasm` versionado é o do pacote oficial **`tree-sitter-c-sharp@0.23.1`** (MIT, sha256 `d7fe0bf8…46e3`), a última com o formato de gramática 14 que o `web-tree-sitter` 0.22 aceita (a 0.23.5 é formato 15). Não virou dependência (o pacote tem script de instalação nativo): o `copy-wasm.cjs` não copia mais o C#, para não sobrescrever. O extrator aceita as duas árvores (`this`/`base` anônimos, valor direto no `variable_declarator`, alias de `using` no campo `name`, parâmetro implícito de lambda, operador `+=` como token). O extrator de regras do MediatR também (o `+=`). +1,9 MB no `.wasm`.
    2. **Métodos de extensão do projeto** (`todo.AsTodoItem()`): `SymbolNodeAttrs.extensionOf`. Num tipo do projeto (a classe, uma base ou uma interface dela) a chamada é provada; num tipo de fora, só quando o tipo DECLARADO do receptor é o do `this` (`List<Order> _all; _all.Sum()`) — e `_db.Orders.Add()` continua do EF Core mesmo com um `Add(this HashSet<T>)` no projeto. Religa pelo nome do método (`typeDependents` com `ext:`).
    3. **MediatR** (aspnet-realworld e clean-architecture: 0 rotas sensíveis, porque o controller só faz `_mediator.Send(...)`): `Send`/`Publish` com o tipo estático da mensagem (`new Create.Command()`, parâmetro ou campo tipado) vão ao `Handle` de quem a trata (`SymbolNodeAttrs.handles`, de `IRequestHandler<TMsg, R>`/`INotificationHandler<TMsg>`). A mensagem e a de cada handler são resolvidas pelo índice de tipos, cada uma no arquivo dela: o `Create.Command` de Articles e o de Comments são classes diferentes (a 1ª versão comparava o texto e ligava as três features; 258 operações viraram 87). Sem a classe da mensagem, o nome simples dá palpite (`heuristic`).
    4. **Classe aninhada** guarda as de fora (`container: 'Create'`): `Create.Command` resolve qualificado; sem qualificar, o aninhado de um namespace visível continua valendo (o arquivo não diz de dentro de qual classe veio o nome).
    5. **Ardalis.Specification** (eShopOnWeb: 0 sensíveis): `RepositoryBase<T>`/`IRepositoryBase<T>` → pacote `Ardalis.Specification.EntityFrameworkCore`; `GetByIdAsync`/`ListAsync`/... leitura, `AddAsync`/`UpdateAsync`/`DeleteAsync` escrita (eles já salvam), na entidade do `IRepository<T>` injetado, `via: 'efcore'`.
    6. **FastEndpoints** (as rotas do `PublicApi` do eShopOnWeb): `Get("api/x")`/`Post(...)` do pacote dentro do `Configure()` de `X : Endpoint<Req, Res>`; o handler é o `ExecuteAsync`/`HandleAsync` da classe. eShopOnWeb: 25 → 48 rotas.
    7. **Genéricos da BCL** (`List<T>`, `Dictionary<K,V>`, `IEnumerable<T>`, `Func<T>`...) viram `System.<nome>`: nativos (o realworld tem uma classe `List`, e `new List<Tag>()` ligava a ela; o C# separa pela aridade, que o mapa não guarda), mas com o nome para os métodos de extensão.
    8. **Campo declarado com tipo nativo** (`static readonly string[] Fields` num `DbContext`) é nativo, não do pacote da base (só C#/Java).
  - **Tabela (2026-10-16):**

    | Projeto | Pilha | Arquivos | Provadas | Por nome | Sem alvo | Rotas | Sensíveis | Operações |
    |---|---|---|---|---|---|---|---|---|
    | todoapi | C#, minimal APIs, EF Core | 40 | 99,1% | 0 | 1 | 11 | 8 | 9 |
    | aspnet-realworld | C#, controllers, MediatR, EF Core | 105 | 99,0% | 0 | 4 | 19 | 18 | 87 |
    | clean-architecture | C#, minimal APIs, MediatR, EF Core | 163 | 95,6% | 4 | 8 | 0 | 0 | 0 |
    | eshoponweb | C#, controllers + FastEndpoints, Ardalis, EF Core | 391 | 99,2% | 1 | 4 | 48 | 9 | 14 |

  - **O que sobra (anotado, não é bug):**
    - clean-architecture: as rotas são registradas por uma DSL do próprio projeto (`groupBuilder.MapPost(Handler, "{id}")`, um método de extensão dele) com o grupo saindo do nome da classe por reflexão (`app.MapGroup(GetType().Name)`); não dá para ler sem executar. O `MapPost` de verdade fica dentro do método de extensão, com o caminho num parâmetro;
    - as chamadas sem alvo que sobram: `PasswordHasher<object>` (do ASP.NET Identity) contra a classe `PasswordHasher` do projeto (aridade, de novo), `AsTask`, `Expect` (Playwright) e extensões de teste;
    - `ManageController` (Identity) e Razor Pages não têm operação: o `UserManager` não é banco no mapa.
  - **TS não mudou:** os 12 projetos da etapa M deram os mesmos números da tabela de 2026-10-13.
  - Suíte **387** (+6).
- 2026-10-16: **L6 concluída (a extensão com C#).**
  - O grafo da extensão já indexa `.cs` (o `CodeGraph.create` carrega a gramática de C#, e o `esbuild.mjs` copia todos os `.wasm`). O `FILE_GLOB` já tinha `cs`.
  - **Um parse só:** o `WorkspaceModel` tira as regras do MediatR da árvore de C# do grafo (`onParsed` com `language: 'csharp'`), como já fazia com o TS. O registro só lê o arquivo quando o grafo não o parseia (Java, Python, ou a gramática não carregou): `CodeGraph.parsesCode(fsPath)`.
  - Textos: o aviso "nenhuma rota reconhecida" cita o ASP.NET Core (4 idiomas); o README da extensão diz que o mapa completo é de JS, TS e C#, e o caos só de JS/TS.
  - `dist/extension.js`: 707 KB (era 679 KB; +28 KB do extrator de C#; o LangGraph continua fora).
  - **Avisos do build que já existiam** (não são desta etapa): `import.meta` vazio em `packages/core/src/wasm-path.ts` e `packages/viewer/src/index.ts`, e a **chave `menus` duplicada no `apps/vscode/package.json`** (linha 212): no JSON, a segunda apaga a primeira, então algum menu pode estar sumindo. Não corrigido (fora do escopo; avisar o usuário).
  - **Não conferido num VS Code real** (o combinado é perguntar antes de abrir o VS Code ou rodar o E2E).
  - Suíte **381** (+1 em `apps/vscode/test/workspace.test.ts`).
- 2026-10-16: **L4 concluída (I/O do C#).** Em `topology/io.ts`, pela regra de sempre: a operação sai do pacote para o qual a chamada resolveu no grafo, nunca do nome da variável.
  - **EF Core** (`via: 'efcore'`): leitura só no que materializa (`ToListAsync`, `First*`, `Single*`, `Any`, `Count`, `FindAsync`...; `Where`/`Include`/`OrderBy` só montam a consulta); escrita em `Add`/`Update`/`Remove`/`Attach` e `ExecuteUpdate`/`ExecuteDelete`; o alvo é a entidade do `DbSet<T>`, inclusive no fim de uma consulta encadeada (o `entityOf` segue o `receiverCall` em C#/Java). `SaveChanges` vira `db_tx` (`SaveChanges`); `BeginTransaction`/`Commit`/`Rollback` viram `startTransaction`/`commitTransaction`/`abortTransaction`, os nomes que o `sensitivityTags` já entende. SQL cru (`FromSqlRaw`, `ExecuteSqlRaw`...) pelo `classifySql`, com `FOR UPDATE`; o materializador depois de um `FromSqlRaw` não conta de novo.
  - **Dapper** (`via: 'dapper'`): `Query*`/`Execute*` numa conexão ADO.NET (`IDbConnection`, Npgsql, SqlClient, MySqlConnector, Sqlite), com o SQL literal classificado; SQL que não é literal vira `db_unknown`.
  - **HttpClient** (`via: 'httpclient'`): `GetAsync`/`PostAsync`/`SendAsync`/`*AsJsonAsync`..., inclusive o cliente do `IHttpClientFactory.CreateClient()`; o host vem da URL literal (relativa ou `SendAsync` → `dynamic`). **O timeout sai `unknown`:** o do `HttpClient` é do cliente (100 s por padrão), configurado fora da chamada (injeção, `AddHttpClient`), então o `no-timeout` não aparece no C#.
  - **CodeGraph:** campo herdado de uma base de pacote (`_db.Database`, com `Db : DbContext`) é do pacote (só em C#/Java).
  - **No exemplo:** `POST /api/Checkout` sai com as mesmas tags do `checkout-express` (corrida e `no-transaction` em `StockItem`, `write-after-api-call` em `Order` e `StockItem`, `external-io` no Stripe), menos o `no-timeout`; tudo `proven`.
  - **O caos continua só JS/TS** (os testes gerados são Vitest + supertest). O `shieldepy chaos` (e o "Testar Caos" da extensão, que usa o mesmo comando) agora para com exit 2 e aponta o `shieldepy topology` quando a pasta não tem JS/TS; num repositório misto, as rotas de C#/Java ficam fora do caos, com um aviso.
  - Suíte **380** (+3 do C#, +1 da CLI).
- 2026-10-16: **L3 concluída (rotas do ASP.NET Core).** Em `topology/routes.ts`, junto das do Express e dos decorators, com a mesma regra: só conta o que resolve para o pacote do ASP.NET Core.
  - **Controllers:** `[Route]` na classe (um ou vários) e `[HttpGet]`/`[HttpPost]`/... e `[Route]` no método. `[controller]` = nome da classe sem `Controller`; `[action]` = nome do método sem `Async` (o padrão do ASP.NET Core). Template do método com `/` ou `~/` ignora o da classe. Verbo sem template usa o `[Route]` do método ou só o da classe; `[Route]` sem verbo vira `ALL`. Classe sem `[Route]` tem prefixo vazio. O caminho fica na sintaxe do ASP.NET (`{id:int}`), como está escrito.
  - **Minimal APIs:** `MapGet`/`MapPost`/`MapPut`/`MapPatch`/`MapDelete` num receptor do `Microsoft.AspNetCore.Builder` ou `Routing` (o `app`, um grupo ou o `IEndpointRouteBuilder` de um método de extensão). O prefixo vem dos `MapGroup("/x")` de onde o receptor veio, em cadeia (`app.MapGroup("/a").MapGet(...)`) ou por variável (`var api = app.MapGroup("/api")`), aninhados. Para isso o `CallSite` ganhou o `receiverCall` (só em C#/Java): a chamada que produziu o receptor, com os argumentos.
  - Caminho não literal (`[HttpGet(Constantes.Rota)]`, `app.MapGet(path, ...)`) vai para `skipped`, como no Express.
  - Um atributo `HttpGet` declarado no próprio projeto não é rota (resolve para a classe do projeto, não para o pacote).
  - No exemplo: `POST /api/Checkout` (controller) e `GET /api/orders/{id}` (minimal API, handler inline).
  - **Limitações:** um grupo recebido como parâmetro (`MapOrders(this RouteGroupBuilder g)`) fica sem o prefixo de quem o criou, porque a chamada do método de extensão resolve para o pacote, não para o método do projeto. O roteamento por convenção (`MapControllerRoute("{controller}/{action}")`) não é lido. `MapMethods` fica de fora.
  - Suíte **376** (+4).
- 2026-10-16: **Correção à parte (`git-base.ts`):** no macOS, o `/var` é atalho para `/private/var`, e o `path.relative` entre a pasta e o topo do repositório (que o git devolve pelo caminho real) saía para fora dele. Os 8 testes de `diff.test.ts` falhavam no Mac; agora a pasta passa por `realpath` antes.
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

## Q — qualidade no projeto real (2026-10-09)

**Por que existe.** O usuário perguntou se a extensão já funcionava em projetos reais. Até então ela só tinha sido testada nos exemplos feitos sob medida. Rodar o motor no próprio ShielDepy (`shieldepy graph|cycles|report|topology` em `packages/` e `apps/`) mostrou três problemas que queimariam a confiança no primeiro uso:
1. **Minificados no mapa.** A extensão indexava `apps/vscode/media/vendor/cytoscape.min.js` e afins. A cobertura de `apps` caía para 57% (2.821 ligações por nome, 2.795 delas do vendor) e apareciam **320 "ciclos"** sem sentido.
2. **Ciclo falso.** Em `FindingsManager.ts` surgia `set → publish → set`: o `this.diagnostics.set(...)`, um campo vindo de `vscode.languages.createDiagnosticCollection()` e por isso sem tipo, caía no palpite por nome e achava o `set()` da própria classe. Ciclo "provado" apoiado numa ligação por palpite.
3. **Recursão como aviso.** Os 4 ciclos de `packages/` são recursão mútua de propósito no resolvedor (`resolveCall → resolveReturnMember → resolveCall`). Num projeto grande, todo parser ou algoritmo recursivo viraria aviso.

O usuário decidiu: corrigir o 1 e o 2, e **rebaixar a recursão** ("esse projeto é pequeno e já deu errado, imagina os gigantescos").

**Tarefas (todas ✅, branch `feat/qualidade-mapa`):**
- **Q1. Código gerado fora do mapa.**
  - `looksGenerated(caminho, texto)` (core) pega pelo nome (`*.min.js`, `*.bundle.js`, `*.chunk.js`) ou pela forma do texto: mais da metade dele em linhas com mais de 1.000 caracteres, ou média acima de 200 por linha. Uma linha longa sozinha, como base64 ou um SVG num `.tsx`, **não** tira um arquivo escrito à mão do mapa.
  - Fica no `CodeGraph.updateFile`, então vale para a CLI e para a extensão. Um arquivo já indexado que vira minificado sai do mapa.
  - `IGNORED_DIRS` ganhou `vendor`, `bower_components`, `build`, `coverage`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache` e `.output`. A extensão monta o `EXCLUDE_GLOB` e o filtro de pastas a partir dessa mesma lista, para nunca mais divergirem.
- **Q2. Ciclo só com prova.**
  - `findCycleThrough` ignora as arestas `heuristic`.
  - Na causa: em `this.campo.m()` com o campo sem tipo, o palpite por nome não considera mais os métodos da própria classe, porque `m` é do objeto guardado no campo.
  - **Bug antigo achado no caminho:** o `CodeGraph.hasEdge(a, b)` usava `graph.edges(a, b)`, que no graphology **ignora a direção**. Os testes que negavam uma ligação podiam passar por engano. Agora usa `outEdges(a, b)`, e os 330 testes seguem passando.
- **Q3. Recursão leve.**
  - `SymbolCycle.recursion` diz se todas as funções da cadeia estão no mesmo arquivo.
  - Na extensão, a recursão vira achado **leve** ("Recursão entre funções deste arquivo…", com "confira a condição de parada"). Ciclo entre arquivos continua aviso.
  - A verificação de correção da IA não barra mais por recursão.
  - Na CLI, o `cycles` separa "entre arquivos" (o que o `--fail-on` barra e o que sai no `--json`) de "recursão no mesmo arquivo" (só informa).

**Antes e depois, no próprio ShielDepy:**

| | Antes | Depois |
|---|---|---|
| `apps`: cobertura provada | 57,0% | 98,8% |
| `apps`: ligações por palpite | 2.821 | 24 |
| `apps`: ciclos | 320 | 0 |
| `packages`: avisos de ciclo | 4 | 0, com as 4 recursões como informação |

Testes: 330 unitários (+5 em `packages/core/test/real-project.test.ts`) e E2E 33/33.

**Ainda não validado:** um projeto real de terceiros, grande. O próprio ShielDepy não usa Express com pg ou Prisma, então o caos não se aplica a ele: o portal é `node:http` com `node:sqlite`, e a topologia dá 0 rotas. É isso que a F resolve.

## C — caos utilizável (escrito em 2026-10-09, antes de começar)

### Por que existe
O caos é o produto. Hoje ele tem dois gargalos, e nenhum dos dois foi medido fora dos nossos exemplos:
1. **Alcance.** Só enxerga rotas **Express** com **pg ou Prisma** e APIs por `fetch` ou `axios`. Em qualquer outro projeto, o "Testar Caos" diz "nenhuma rota sensível" e o produto principal não roda. No próprio ShielDepy (portal em `node:http` com `node:sqlite`), a topologia dá 0 rotas.
2. **Contrato manual.** Mesmo no Express, o `shieldepy.chaos.config.ts` gerado pela R3 deixa para o usuário escrever:
   - `createApp`: subir o app sem abrir porta;
   - `reset`: zerar o estado;
   - um corpo válido por rota de escrita;
   - a resposta saudável de cada API.

   É onde a pessoa desiste.

**Onde mexer:**
- rotas: `packages/core/src/topology/routes.ts`;
- I/O: `packages/core/src/topology/io.ts`;
- contrato gerado: `packages/core/src/chaos-config.ts` (`chaosConfigScaffold`) e `apps/cli/src/chaos.ts` (`--init`);
- comando da extensão: `apps/vscode/src/chaos/ChaosCommand.ts`;
- templates dos testes: `packages/agent/src/chaos/templates.ts`.

### Ordem
**C1 → C2 → release (C5) → C3 → C4.** A C1 mede antes de mexer, a C2 tira o maior atrito de quem já é suportado, o release sai quando o Express estiver "sem escrever nada", e a C3 aumenta o alcance fatia por fatia. A C4 pode entrar a qualquer momento depois da C1, porque é meio dia e depende do usuário mexer no GitHub.

### Tarefas
- **C1. Caos em 2 ou 3 projetos Express reais de terceiros (1–2 dias).**
  - **Escolha:** projetos públicos, ativos, de tamanhos diferentes, com Express e pg ou Prisma, e com pelo menos uma rota que lê e grava ou chama uma API externa. Pelo menos um em TS e um em JS. **Candidatos a conferir** (podem ter mudado; confira o `package.json` antes de usar):
    - `gothinkster/node-express-realworld-example-app` (Prisma);
    - o exemplo `rest-express` do `prisma/prisma-examples`;
    - um boilerplate Express com pg (`pg` ou `node-postgres`).

    Se algum não servir, achar outro pelo mesmo critério e registrar o porquê.
  - **Para cada um, medir e registrar numa tabela no Registro:**
    1. tamanho (arquivos, símbolos) e tempo do `shieldepy graph`;
    2. cobertura provada, ligações por palpite e o ruído (ciclos, colisões falsas), com a causa de cada falso positivo;
    3. rotas achadas × rotas reais (conferir à mão num recorte) e rotas sensíveis;
    4. o `--init`: quantas pendências e o que o mapa errou (host, rota, parâmetro);
    5. **o tempo e o que foi preciso para deixar o contrato rodando de verdade** (subir o app sem porta, banco em memória ou de teste, `reset`);
    6. o resultado do `shieldepy chaos`: os controles passaram? Quantos achados? Algum é falso? (Abrir o teste e conferir.)
  - **Como rodar:** clonar no scratchpad, `npm install --ignore-scripts` (ou o gerenciador do lockfile), `npm run cli -- graph|cycles|topology <pasta>` e `npm run cli -- chaos <pasta> --init`. Preencher o contrato, depois `npm run cli -- chaos <pasta> --offline --report <arquivo>`. O banco: preferir o que o projeto já usa nos testes dele; senão PGlite (o `checkout-express` usa) ou o SQLite do Prisma.
  - **Corrigir dentro da C1** o que for bug barato do motor (como na Q), cada um com um teste em `packages/core/test/real-project.test.ts`. O que for grande vira tarefa nova neste plano.
  - **Pronto quando:** a tabela está no Registro, os bugs baratos estão corrigidos com teste, e existe uma lista ordenada do que a C2 precisa resolver, tirada do que realmente doeu.
- **C2. Contrato quase automático (3–5 dias).** Meta: num projeto Express suportado, o `--init` gera um contrato que **roda sem edição** (os controles passam) ou com **no máximo 1 pendência**. Ajustar a ordem pelo que a C1 mostrar.
  - **C2a. `createApp`.** Achar pela AST onde o app é montado: a chamada `express()` (ou `Router` montado nela), o arquivo e o símbolo exportado (fábrica `createApp()`, `export const app` ou `export default app`). Distinguir do `app.listen()`: se o app só existe dentro do arquivo que dá `listen`, o contrato não pode importar esse arquivo, porque abriria a porta. Nesse caso, a pendência diz exatamente o que separar. Gerar o `import` e o `createApp: () => app` certos.
  - **C2b. Corpos válidos.** Gerar o `body` de cada rota de escrita a partir do que o projeto já valida, nesta ordem:
    1. schema `zod` ou `joi` usado no handler ou no middleware da rota;
    2. DTO do `class-validator`;
    3. o tipo TS do `req.body` (`Request<{}, {}, Body>` ou anotação);
    4. as propriedades lidas de `req.body.x` no handler.

    Valores de exemplo por tipo (string, número, e-mail, uuid, enum: o 1º valor). Sem fonte, fica a pendência.
  - **C2c. Parâmetros de rota.** Hoje `:id` vira `1`. Melhorar quando o tipo for conhecido (uuid, por exemplo).
  - **C2d. `reset` e banco de teste.** Pelo banco detectado na topologia, gerar o `reset` e o `setupFiles` sugeridos:
    - Prisma: `deleteMany` nas tabelas tocadas, ou um banco SQLite ou de teste;
    - pg: PGlite em memória, como no `checkout-express`, com o schema vindo das migrações do projeto quando existirem.

    Se não der para gerar com segurança, a pendência explica o que fazer, com um exemplo.
  - **C2e. `apis`.** Resposta saudável de cada host: se o projeto usa o SDK oficial (Stripe e afins), um formato mínimo conhecido; senão `{}` com a pendência.
  - **Testes:** cada sub-tarefa com teste de unidade no core e um exemplo novo em `examples/` quando precisar. A aceitação é o `--init` dos projetos da C1 (e do `checkout-express` sem o contrato) chegar à meta.
- **C3. Caos além do Express: a etapa F (3–5 semanas, em fatias).** Ver a seção "F" abaixo: desenho, fatias F1–F7 e ordem (F3 `node:http`, prova no próprio portal → F1 Fastify → F6 SQLite e Mongoose → F4 NestJS → F5 Next.js → o resto). **Cada fatia leva a C2 junto:** o `createApp` e os corpos daquele framework, não só as rotas.
- **C4. Caos no CI de verdade (meio dia; o usuário mexe no GitHub).** Preparar um PR de teste que mexa numa rota sensível do `checkout-express` e rodar o `shieldepy-chaos.yml` no Actions. Conferir:
  - o comentário com o relatório;
  - o portão barrando (exit 1);
  - o escopo `--base`.

  O usuário abre o PR e confere; eu preparo a branch e as instruções.
- **C5. Release v0.1.0 (cerca de 1 hora, depois da C2).**
  1. Perguntar a licença (MIT ou todos os direitos reservados) e se o repositório é público. Se for privado, só quem tem acesso baixa o `.vsix`.
  2. Atualizar o CHANGELOG e rodar `npm run package:vscode`.
  3. Conferir o pacote: E2E contra a extensão instalada do `.vsix` (ver "Como rodar").
  4. Entregar o comando `gh release create v0.1.0 …` para o usuário publicar.

---

## L — motor por linguagem e C# (escrito em 2026-10-16, antes de começar)

### Por que existe
O mapa completo (símbolos, chamadas resolvidas pelo tipo, rotas, I/O) só existe para JS/TS. C#, Java e Python são lidos só para as regras de evento (`packages/extractors`). O usuário decidiu: **C# primeiro, depois Python**, no nosso motor.

### O que prende o motor ao TS hoje (conferido no código)
- `CodeGraph.updateCodeFile` só chama o `TsParser`, e as funções de extração (`extract-ts`, `extract-module`) leem a AST do TS.
- **A resolução de nomes é por import de arquivo:** `ImportBinding` + `ModuleResolver` (`./x`, `paths` do tsconfig, pacotes do npm). No C# não há import de arquivo: `using App.Services;` torna visíveis os tipos de um **namespace**, que se espalha por vários arquivos (e `partial class` divide uma classe entre arquivos).
- O que já é genérico e fica igual: o grafo (`SymbolInfo`, `RawCall` com `receiver`, `CallSite`), a manutenção incremental, a religação, a cobertura, a topologia, o visualizador e o caos.

### Desenho (decisões; registrar o porquê se mudar)
- **Interface por linguagem** (`LanguageFrontend`): extensões, parser e `extract(raiz) → { símbolos, módulo, chamadas }`. O TS vira uma implementação, **sem mudar o comportamento** (os testes atuais são a prova). O `CodeGraph` escolhe o frontend pela extensão.
- **Resolução por namespace no C#:**
  - cada classe guarda o `namespace`;
  - o `CodeGraph` mantém um índice nome simples → classes;
  - um nome resolve para as classes dos namespaces visíveis no arquivo: o próprio namespace e os de cima, os `using` (inclusive `global using` de qualquer arquivo) e o global;
  - quem resolveu um nome por esse índice é religado quando uma classe com esse nome entra ou sai (como o `interfaceDependents` já faz com interfaces).
- **Base × interface:** no C# a lista de bases mistura a classe-base e as interfaces. A primeira vira `extends` e todas entram em `implements`. A base é resolvida **sem** cair nas implementações (uma interface na 1ª posição não vira "classe-base").
- **Tipos de fora do projeto:**
  - os que importam para o caos vão para um "pacote" pelo nome: `DbContext`/`DbSet` → EF Core, `HttpClient` → `System.Net.Http`, `ControllerBase` → ASP.NET Core;
  - os outros (BCL: `string`, `List`, `Task`, LINQ) são nativos e não contam na cobertura.
  - Não há como saber o pacote de um tipo qualquer sem o compilador; registrar o que ficar de fora.
- **Rotas (ASP.NET Core):** `[ApiController]` + `[Route("api/[controller]")]` na classe e `[HttpGet("{id}")]` no método (com `[controller]` trocado pelo nome sem "Controller"); minimal APIs (`app.MapGet("/x", handler)`, `MapGroup`).
- **I/O:**
  - EF Core: `DbSet<T>` dá a entidade. `Find/FirstOrDefault/Where/ToList...` (inclusive `Async`) = leitura; `Add/Update/Remove` = escrita pendente, e `SaveChanges(Async)` = a escrita de fato; `BeginTransaction` = transação.
  - `HttpClient`: `GetAsync/PostAsync/SendAsync...` = `api_call`, com host e timeout quando literais.
  - Dapper e SQL cru (`ExecuteAsync`/`QueryAsync` com SQL literal) pelo analisador léxico.

### Tarefas
- **L1. Motor por linguagem.** ✅ Concluída em 2026-10-16. `LanguageFrontend` (`code-graph/frontend.ts`: extensões, `parse`, `extract → { símbolos, módulo, valueCalls, chamadas, topHash }`); o `tsFrontend` embrulha os extratores de antes; o `CodeGraph` escolhe pela extensão; o `onParsed` diz a linguagem (a extensão só tira regras de TS da árvore de TS). Os 365 testes passam sem mudança.
- **L2. C#: símbolos, namespaces e chamadas.** ✅ Concluída em 2026-10-16 (ver o registro).
  - Classes, interfaces, structs e records, métodos, construtores, campos e propriedades com tipo, e parâmetros.
  - Receptor por tipo: campo, parâmetro, `var x = new X()`, `this`/`base`, estático `Tipo.M()`, chamada sem receptor dentro da classe.
  - Injeção pelo construtor com interface → implementações.
  - Testes de unidade e um exemplo `examples/pedidos-aspnet`.
- **L3. Rotas do ASP.NET Core** (controllers e minimal APIs). ✅ Concluída em 2026-10-16 (ver o registro).
- **L4. I/O do C#** (EF Core, `HttpClient`, Dapper). ✅ Concluída em 2026-10-16 (ver o registro).
- **L5. Projetos C# reais no `mapa:reais`:** 3 a 5 do GitHub, fixados por commit, na tabela. ✅ Concluída em 2026-10-16 (ver o registro).
- **L6. Extensão:** indexar `.cs` no grafo (hoje só regras), o mapa e o resumo da M6. ✅ Concluída em 2026-10-16 (ver o registro); falta conferir num VS Code real. O caos em C# **não** entra nesta etapa: os testes gerados são Vitest/supertest, e para C# seriam xUnit/`WebApplicationFactory`, outra etapa.

## J — Java no motor (escrito em 2026-10-16, antes de começar)

### Por que existe
Pedido do usuário: "crie os adaptadores para C# e após isso Java". A etapa L deixou o motor por linguagem e a resolução por namespace prontas; o Java reaproveita as duas. O alvo é o **Spring Boot**: as rotas, o Spring Data JPA, o JdbcTemplate, o `EntityManager`, o `RestTemplate`/`WebClient`/`RestClient` e o `@Transactional`. O caos continua só JS/TS.

### Desenho (decisões; registrar o porquê se mudar)
- **Frontend `extract-java.ts`** (gramática `tree-sitter-java` do `tree-sitter-wasms`, que lê records, `var` e text blocks sem erro — conferido).
- **Resolução por package**, pelo mesmo `NamespaceScope` do C#: visível = o próprio package e os `import x.*;`; cada `import x.y.Tipo;` é um alias (`Tipo` → `x.y.Tipo`). Sem "namespaces de cima" (o Java não tem). `import static` fica de fora.
- **Tipos de fora** só pelo import (o Java sempre importa): um `import` cujo nome qualificado começa por um prefixo conhecido vira ligação para o pacote — `org.springframework.data` (repositórios), `org.springframework.jdbc`, `jakarta.persistence`/`javax.persistence`, `org.springframework.web.client` (`RestTemplate`, `RestClient`), `org.springframework.web.reactive.function.client` (`WebClient`), `org.springframework.web.bind.annotation` (rotas), `org.springframework.transaction`, `java.net.http`. No `import x.*;` de um prefixo conhecido, só os nomes da lista dele.
- **Repositório do Spring Data** (`interface OrderRepository extends JpaRepository<Order, Long>`) vira símbolo de classe (sem os métodos declarados, que o Spring gera): a base é o pacote e o `extendsArg` é a entidade — o mesmo caminho do `Repository<Pet>` do TypeORM. Interface comum continua sem símbolo (cai nas implementações, como no TS e no C#).
- **Lombok:** classe com `@Data`/`@Getter`/`@Setter`/`@Value`/`@Builder` ganha os acessores gerados (`getX`, `setX`, `isX`, `builder`) em `properties`: chamá-los é nativo, não "sem alvo". Enum ganha `values`/`valueOf`/`name`/`ordinal`.
- **Retorno:** `Optional<T>`, `CompletableFuture<T>`, `Mono<T>` viram T (como o `Task<T>` do C#); coleções viram nativo.
- **Anotações** viram chamadas `decorates` (como os atributos do C#). Os argumentos: o valor posicional, e os pares `chave = valor` num `object` com `values` (o `CallArg` ganha `values` e o tipo `constant`, para `RequestMethod.POST`).
- **Rotas (Spring MVC):** `@RequestMapping` na classe (um ou vários caminhos) e `@GetMapping`/`@PostMapping`/... ou `@RequestMapping(method = ...)` no método; sem `method`, `ALL`.
- **I/O:** Spring Data (pelo nome do método: `save*`/`delete*` escrita, `find*`/`get*`/`count*`/`exists*` leitura, na entidade do repositório), JdbcTemplate (SQL literal), `EntityManager` (`persist`/`merge`/`remove`, `find`, `createNativeQuery`), `@Transactional` (abre transação na entrada do método), `RestTemplate` (host da URL), `WebClient`/`RestClient` (o host vem do `.uri("...")` da cadeia, no `retrieve`). Timeout: `unknown` (é do cliente).

### Tarefas
- **J1. Java: símbolos, packages e chamadas** (classes, records, enums, métodos, construtores, campos com tipo, injeção por construtor/campo, Lombok, repositórios do Spring Data), com testes. ✅ Concluída em 2026-10-16 (ver o registro).
- **J2. Rotas do Spring MVC.** ✅ Concluída em 2026-10-17 (ver o registro).
- **J3. I/O do Java** (Spring Data, JdbcTemplate, `EntityManager`, `@Transactional`, `RestTemplate`/`WebClient`/`RestClient`). ✅ Concluída em 2026-10-17 (ver o registro).
- **J4. Exemplo `examples/pedidos-springboot`:** o checkout do `checkout-express` em Spring Boot, com os mesmos defeitos. ✅ Concluída em 2026-10-17.
- **J5. Projetos Java reais no `mapa:reais`.** ✅ Concluída em 2026-10-17 (ver o registro).
- **J6. Extensão:** `.java` no grafo, as regras do `@EventListener` da mesma árvore, textos. ✅ Concluída em 2026-10-17; falta conferir num VS Code real.

## M — mapeamento em projetos reais (escrito em 2026-10-13)

### Por que existe
O usuário pediu para deixar o mapeamento em grafos "100%" antes de qualquer outra coisa, testando em apps Node/Express do GitHub. A C1 tinha medido 3 projetos (todos com 100% das chamadas provadas depois das correções). Ampliando para projetos em **CommonJS com Mongoose**, que é a pilha mais comum dos boilerplates Express, o mapa caía muito:

| Projeto (clonado no scratchpad, `--depth 1`) | Linguagem / banco | Arquivos | Chamadas provadas antes | Depois da M1 |
|---|---|---|---|---|
| `gothinkster/node-express-realworld-example-app` | TS, Prisma | 39 | 100% | 100% |
| `prisma/prisma-examples` (`orm/express`) | TS, Prisma 7 | 3 | 100% | 100% |
| `manfraio/rest_api_with_nodejs_and_postgres` | JS, `pg` | 6 | 100% | 100% |
| `hagopj13/node-express-boilerplate` | JS (CJS), Mongoose | 50 | **87,1%** (22 sem alvo) | **100%** (205 provadas) |
| `danielfsousa/express-rest-boilerplate` | JS (CJS), Mongoose | 26 | **41,7%** (44 sem alvo) | **90,2%** (4 por nome) |
| `w3tecch/express-typescript-boilerplate` | TS, TypeORM, `routing-controllers` | 80 | 97,7% | 97,7% |

A topologia desses três últimos mostrou o resto do que falta (ver as tarefas).

### Tarefas
- **M1. CommonJS e Mongoose no grafo.** ✅ Concluída em 2026-10-13 (ver o registro).
- **M2. Rotas que o mapa não lê.** ✅ Concluída em 2026-10-13 (ver o registro).
  - `router.route('/x').get(a).post(b)`: hoje sai "caminho não literal" (19 rotas nos dois boilerplates).
  - Montagem em laço: `[{ path: '/auth', route: authRoute }].forEach((r) => router.use(r.path, r.route))` perde o prefixo e vira middleware opaco.
- **M3. Mongoose como I/O.** ✅ Concluída em 2026-10-13 (ver o registro); entrou junto o handler embrulhado (`catchAsync(fn)`). `Model.find*/count*` = leitura e `create/save/update*/delete*/insertMany` = escrita, com o nome do modelo como alvo e `startSession`/`withTransaction` como transação. Sem isso, nenhuma rota de um projeto com Mongoose é "sensível". (É a parte Mongoose da F6, adiantada.)
- **M4. Rotas por decorators:** ✅ Concluída em 2026-10-13 (ver o registro), com o TypeORM como I/O. `routing-controllers` (`@JsonController('/users')` + `@Get('/:id')`) e NestJS (`@Controller` + `@Get`). O tsboiler dá 0 rotas. (É a F4, adiantada.)
- **M5. Mais projetos medidos e um roteiro para repetir a medição.** ✅ Concluída em 2026-10-13: M5a e M5b (correções), 12 projetos e o `npm run mapa:reais` (ver o registro). Pelo menos 8 projetos de tamanhos diferentes na tabela acima, com as rotas conferidas à mão num recorte, e um script (`npm run mapa:reais`) que clona numa pasta temporária, mede e imprime a tabela.
- **M6. Fluxo do plugin "instalar e rodar".** ✅ Concluída em 2026-10-13 (ver o registro); falta conferir num VS Code real (E2E e um projeto aberto à mão). Ao abrir o projeto, o plugin mapeia sozinho e mostra um resumo (rotas, operações, cobertura, onde o mapa é fraco), com o próximo passo (diagnosticar). Conferir o que a R1/R2 já entregam antes de mexer.

### Limitações conhecidas (anotadas, não são bug)
- **Métodos de instância do Mongoose:** resolvem quando o documento é seguível (`const user = await User.findById(id)`, `new User(b).save()`, `.exec()`). Ficam por nome (heurística) quando o valor vem de fora da função: `req.user.transform()`, o parâmetro de `.then((user) => ...)` ou de `users.map((u) => ...)`.
- **`withTransaction(cb)`** só fica anotado como `db_tx`: as operações do callback vêm antes dele na ordem de execução aproximada, então não contam como "dentro da transação". O `startTransaction`/`commitTransaction` explícito conta.
- **Plugins do Mongoose** (`schema.plugin(paginate)`, que adiciona `User.paginate`): o método fica como "do pacote" e não vira operação.

## F — rotas e I/O do resto de JS/TS (escrito em 2026-10-09, antes de começar)

**Decisão do usuário:** cobrir o resto de JS/TS, não só o Express.

**O que já serve:** os testes gerados usam o `supertest`, que aceita qualquer servidor HTTP do Node:
- Express e Koa (`app.callback()`);
- Fastify (`app.server`, depois de `ready()`);
- Nest (`app.getHttpServer()`);
- `node:http` puro.

O `createApp` do contrato só precisa devolver um desses. O formato da topologia não muda.

**O que falta:** reconhecer as **rotas** e o **I/O** de cada biblioteca (`packages/core/src/topology/routes.ts` e `io.ts`), sem regex, pela AST.

| Fatia | O que | Estimativa |
|---|---|---|
| F1 | Fastify (`app.get/post`, `app.route({...})`, `register` com prefixo) | 1–2 dias |
| F2 | Koa + `@koa/router`, Hono | 1–2 dias |
| F3 | `node:http` puro (`createServer` + `if (req.method === ... && req.url === ...)`): cobre o próprio portal | 2–3 dias |
| F4 | NestJS (`@Controller` + `@Get/@Post`, injeção pelo construtor, que o grafo já segue) | 3–4 dias |
| F5 | Next.js (`app/**/route.ts` com `export async function POST`, `pages/api/**`) | 2–3 dias |
| F6 | Banco: TypeORM, Sequelize, Mongoose, Drizzle, Knex, mysql2, better-sqlite3/`node:sqlite`, driver do MongoDB (leitura, escrita e transação) | 1–2 dias cada |
| F7 | APIs: got, undici, ky, node-fetch e SDKs comuns (Stripe…), como `api_call` com o host | 0,5–1 dia cada |

**Ordem sugerida:** F3 (prova no próprio ShielDepy) → F1 → F6 com SQLite e Mongoose → F4 → F5 → o resto. Cada fatia tem um exemplo pequeno em `examples/` e o teste de aceitação "topologia com as operações em ordem", como o `checkout-express` na E2.

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

**Recomendação:** fazer **depois da E2 em TS**, quando o pipeline estiver provado de ponta a ponta. Ordem sugerida: Java/Spring (melhor retorno; stack comum em empresas) → C#/ASP.NET → Python. Fica como **E7 — outras linguagens** (era a E5, depois E6; renumerada em 2026-10-08).

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

## E6 — DB_Chaos: falha do banco depois da chamada externa (escrito em 2026-10-08, antes de começar)

> Branch `feat/db-chaos`, criada a partir da `main` (`297c964`, já com E4, E5, V2 e V3). A antiga E6 (outras linguagens) virou **E7**. Esta etapa fecha a última falha do catálogo que aparece como "sem teste no MVP".

### O problema que ele prova
`partial_failure_after_external_call`: a API externa já foi chamada (ex.: o Stripe **cobrou**) e a gravação seguinte no banco falha. Se o código não compensa, o sistema fica inconsistente: **cliente cobrado sem pedido**, estoque reservado para sempre.

**Achado já visível no código (vai virar a aceitação):**
- o **exemplo corrigido também tem essa falha**. O `CheckoutService` do `checkout-express-fixed` reserva o estoque, cobra e só depois faz `orders.insert`. Se o `insert` falhar, a cobrança fica sem pedido e a reserva não é devolvida (o `release` só acontece quando o Stripe falha);
- hoje ele "aguenta tudo" porque nenhum teste injeta falha no banco.

O DB_Chaos tem que **pegar isso no corrigido** (e no vulnerável). Depois o corrigido ganha a compensação (estorno no Stripe + devolver a reserva + responder 502) e passa a aguentar. Isso dá um bom roteiro para o TCC.

### O que já existe e é reaproveitado
- **Catálogo:** a entrada `partial_failure_after_external_call` já existe (agente `db_chaos`, habilitada pela tag `write-after-api-call`, alvo = cada tabela gravada depois da API, na lista-base), com `testable: false`.
- **Severidade:** já sai Crítico.
- **Relatório, visualizador e portal:** já mostram a hipótese como "sem teste" e o rótulo "Falha parcial". Quando ela virar teste, aparece como achado sem mudança estrutural.
- **Topologia:** cada operação traz `kind`, `target` (tabela), `via` (`pg`, `prisma`), a ordem e o `arquivo:linha`. A tag `write-after-api-call` traz as tabelas.
- **Template de rede (MSW):** já intercepta a API externa com uma resposta saudável (`apis` do config). O DB_Chaos usa o mesmo servidor para **saber quando a API foi chamada**.

### Desenho (decisões tomadas; registrar o porquê se mudar)
1. **Onde injetar a falha (MVP: `pg`):**
   - o teste gerado espiona `Pool.prototype.query` e `Client.prototype.query` do módulo `pg`, como o app o enxerga (com o `vi.mock('pg')` do projeto, são as classes do banco de teste; sem mock, as do `pg` de verdade);
   - a espiã deixa tudo passar **até a API externa ser chamada** (evento `request:end` do MSW para um host da rota);
   - depois disso, falha a **primeira gravação na tabela alvo** (`INSERT INTO`, `UPDATE` ou `DELETE FROM` naquela tabela) com um erro de conexão simulado.
   - Comparar o SQL em tempo de execução, por tokens (minúsculas, sem regex), é casar o texto que o app manda ao banco, e não ler código, então respeita a regra do projeto.
   - **Prisma fica para depois** (anotado): exigiria espionar o model no cliente gerado.
2. **Como saber se ficou inconsistente: invariantes com contexto.**
   - Hoje os invariantes do config são `() => boolean`. Passam a receber um contexto opcional: `(ctx) => boolean`, com `ctx.apiCalls` = as chamadas que o app fez às APIs externas durante o teste (`{ host, method, path }`, registradas pelo MSW).
   - O exemplo ganha `noChargeWithoutOrder(ctx)`: cobranças (`POST /v1/charges`) − estornos (`POST /v1/refunds`) ≤ pedidos gravados.
   - Quem não usa o contexto continua funcionando. O `readChaosConfig` (AST) não muda: só lê os nomes.
3. **Invariantes padrão do DB_Chaos:**
   - `noUnhandledError` (a falha não pode virar 500 sem tratamento);
   - `statusIn([500, 502, 503])` (a rota tem que responder, e com erro);
   - `respondsWithin` (não pode ficar pendurada);
   - todos os `stateCheck` do projeto, com o contexto.
4. **Especialista DB_Chaos** (tier `fast`, igual aos outros): preenche uma `DbSpec { kind: 'db', target, op: 'insert' | 'update' | 'delete' | 'any', error: 'connection' | 'constraint' | 'timeout', expect }`, validada por `parseSpec`, com padrão do motor e offline. O grafo LangGraph ganha o ramo `db` no fan-out por `Send`.
5. **Controle:** igual aos outros templates. A mesma requisição, sem falha, tem que passar; senão o resultado é `invalid`.

### Tarefas
- ✅ **D1. Contrato com contexto.** Invariantes `(ctx?)`, o tipo `ChaosInvariantContext`, os templates passando `ctx.apiCalls` (o MSW já está em todos), a doc do contrato (`docs/chaos-ci.md`, README, `CONFIG_TEMPLATE` da CLI) e `noChargeWithoutOrder` nos dois exemplos. Teste: os testes de rede e de corrida que já existem continuam passando nos dois exemplos.
- ✅ **D2. Catálogo, spec e especialista.** `testable: true`, `DbSpec` + `parseSpec` + o padrão do motor, o `specialistSystem('db')`, o ramo `db` no grafo. Testes no estilo do `specialists.test.ts`.
- ✅ **D3. Template `db`.** Espiã no `pg` (Pool e Client), ligada pelo `request:end` do MSW, a primeira gravação na tabela alvo falhando, invariantes com contexto, e o teste compilando contra os exemplos (teste de compilação da 3e).
- ✅ **D4. Exemplos:**
  - **vulnerável:** continua sem compensação → achados Crítico (`orders`, `stock`);
  - **corrigido:** **antes de corrigir**, rodar e registrar que o DB_Chaos pega a falha (o "achado no corrigido"). Depois implementar a compensação (`StripeGateway.refund`, `release` da reserva, 502) e conferir que passa;
  - atualizar os testes de topologia da E2 (o corrigido ganha o `api_call` do estorno) e os de fumaça (`npm test` no exemplo).
- ✅ **D5. Superfícies:** CLI (o texto e o JSON já servem; conferir), relatório markdown, visualizador e portal (sem "sem teste no MVP" para a falha parcial; o rótulo do achado já existe); o `self-test` do CI passa a exigir também a falha parcial no vulnerável; e o `RELATORIO-CUSTO-IA.md`, se o número de chamadas mudar (um especialista a mais por hipótese).
- ✅ **D6. Aceitação e docs:** README, `docs/chaos-ci.md` e o registro no plano.

### Aceitação do DB_Chaos
- `chaos examples/checkout-express --offline` → os achados de antes **mais** a falha parcial em `orders` e em `stock` (Crítico), com a invariante `noChargeWithoutOrder` violada.
- `chaos examples/checkout-express-fixed --offline` **antes da compensação** → a falha parcial em `orders` é achada (o corrigido não estava 100%). **Depois da compensação** → exit 0, tudo aguenta.
- Os testes gerados compilam contra os exemplos; a suíte, o E2E e o CI ficam verdes; o portal mostra a falha parcial na operação certa (`grava orders`).

### Fora do escopo (anotado)
- Prisma, TypeORM e Knex: precisam de espiãs próprias.
- Falha no meio de uma transação (`BEGIN … COMMIT`) e rollback: o exemplo não usa transação; entra quando houver um exemplo que use.

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
