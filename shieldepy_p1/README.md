# ShielDepy P1

ShielDepy é uma extensão do VS Code, com CLI e página web, que encontra **bugs de arquitetura
antes do commit**. Ela acha principalmente dois tipos de problema que ninguém "escreveu" sozinho:
eles só aparecem quando dois trechos de código, cada um correto isolado, se encontram.

- **Ciclos de chamada**: `a()` chama `b()`, que chama `a()` de volta, às vezes passando por
  vários arquivos. Resultado: loop infinito ou efeito cascata.
- **Colisões entre regras reativas**: dois handlers do mesmo evento mexem no mesmo campo.
  O preço aplica desconto em `total`, o imposto também reescreve `total`, e a auditoria lê
  `total` sem saber qual dos dois rodou primeiro.

Esses problemas são **provados** por um motor determinístico, sem IA. A IA (Claude ou Gemini),
quando configurada, só **explica** os fatos provados, conversa sobre eles e sugere correções.
Sem chave de IA, tudo o que foi provado continua funcionando.

Este repositório é a fusão de dois projetos do TCC:
**ShielDepy** (extensão, grafo estrutural via Tree-sitter) e **Projeto18 / Grafo de Interações**
(motor que prova colisões).

---

## Como o sistema funciona

### Os dois grafos

O sistema mantém dois grafos em memória, construídos a partir do mesmo código:

| | Grafo estrutural | Grafo de interações |
|---|---|---|
| **Pergunta que responde** | Quem importa e quem chama quem? | Quem lê e quem escreve qual campo, em qual evento? |
| **Nós** | arquivos, funções, métodos, classes, seletores CSS, pacotes externos | regras reativas (um handler, listener, signal ou trigger) |
| **Como é lido** | Tree-sitter (a árvore sintática real) no TS/JS, HTML e CSS | Tree-sitter no TS/JS, Java, Python e C#; analisador léxico no PL/pgSQL |
| **O que prova** | ciclos de chamada; cadeia de chamadas (rota → serviço → repositório → pacote); classe do HTML sem CSS correspondente | colisões write-write e read-after-write |
| **Onde vive** | `packages/core/src/code-graph/` | `packages/core/src/interactions/` |

Um exemplo do que vira regra:

```ts
bus.on('order.updated', (order) => {
  order.total = order.subtotal * 1.1;   // escreve total, lê subtotal
});
```

vira `{ resource: 'order', event: 'order.updated', reads: ['subtotal'], writes: ['total'] }`.

O motor agrupa as regras por **recurso × evento** (o "balde"). Dentro de cada balde, compara
as regras duas a duas:

- **write-write**: duas regras escrevem o mesmo campo. Ganha quem gravar por último → **Crítico**.
- **read-after-write**: uma lê o que a outra escreve. A gravidade depende da ordem:
  - ordem desconhecida (microsserviços, listeners) → valor imprevisível → **Alto**
  - quem lê roda antes → sempre lê o valor velho → **Médio**
  - quem lê roda depois → correto hoje, mas frágil → **Baixo**

### O que acontece na extensão, passo a passo

```
 abrir o workspace
   └─ indexa até `shieldepy.index.maxFiles` arquivos (padrão 3000, sem IA)
        ──► grafo estrutural + regras + colisões; loga a cobertura do mapa
        ──► passou do teto? avisa que o mapa ficou PARCIAL
 mudar tsconfig/jsconfig (`paths`) ──► o grafo refaz a resolução de imports, sem recarregar
                                                   │
 editar / salvar / abrir um arquivo                ▼
   └─ BackgroundAnalyzer (depois de ~1,2 s parado)
        1. reindexa só aquele arquivo (1 parse alimenta os dois grafos)
        2. achados GRÁTIS: ciclos, HTML→CSS quebrado        (origem "grafo")
        3. se há IA: varre só o trecho que mudou, recebendo
           os fatos já provados pra não repeti-los             (origem "ia")
   └─ CollisionPublisher (quando QUALQUER regra do workspace muda)
        recalcula as colisões e publica nos DOIS arquivos    (origem "colisao")
                                                   │
                                                   ▼
 FindingsManager ──► painel Problems (com link pra outra ponta da colisão)
                 ──► marca-texto colorido + hover no editor
                 ──► lista "Problemas encontrados" na barra lateral
                 ──► #id estável, citável no chat
```

**"ShielDepy: Ver Mapa do Sistema"** abre o mesmo visualizador da CLI num painel do editor:
- cobertura e pontos fracos do mapa;
- cadeias em camadas;
- **"Abrir código"**, que leva ao arquivo e à linha.

As bibliotecas (Cytoscape + fcose) vêm de `media/vendor/` com a CSP por nonce, como nos outros webviews.

No **chat** você pergunta sobre um achado, citando o `#id` ou usando "Ask AI" na lista. Se pedir
uma correção, a IA propõe o arquivo inteiro corrigido. **Antes de mostrar o botão "Aplicar"**, a
extensão testa a proposta numa cópia do grafo e confere se ela cria um ciclo ou uma colisão nova.
Se criar, pede à IA uma segunda tentativa. O botão só escreve dentro do workspace.

### O papel da IA (e o limite dela)

- A IA **nunca descobre** colisões nem ciclos: ela recebe os fatos provados e os explica.
- Toda explicação carrega o fato original. A IA não consegue trocar qual colisão está descrevendo.
- Se a IA declarar confiança abaixo de 85%, o status vira **"Requer Revisão Humana"**.
- Se a IA falhar ou responder fora do formato, o **explicador offline** assume, com o mesmo formato.
- A varredura da IA ainda aponta riscos que o motor não modela (race condition, promise sem
  `catch`, listener sem cleanup). Esses achados ficam marcados como origem **`ia`**.

---

### Como uma chamada vira aresta

Cada arquivo TS/JS gera uma **tabela de módulo**:
- imports com o nome local de cada ligação: alias, `default`, `* as ns` e `require`;
- exports e re-exports (barrels);
- o tipo das instâncias de topo.

Os especificadores são resolvidos com o `paths`/`baseUrl` do tsconfig. O que não é do projeto vira nó `pkg:<nome>`.

Uma chamada é resolvida nesta ordem:

1. **Tipo do receptor**:
   - `this` e `super`;
   - campos tipados, `= new X()` e `constructor(private repo: Repo)`;
   - variáveis e parâmetros tipados;
   - retorno anotado de funções (`Promise<T>` vira `T`);
   - chamadas encadeadas.

   A resolução segue `extends`. Para uma interface, liga às classes que a implementam (`implements`).
2. **Ligação de import**, seguindo barrels até onde o símbolo é declarado. Inclui instâncias e objetos exportados.
3. **Símbolo do próprio arquivo.**
4. **Fallback por nome.** A aresta sai marcada `heuristic: true`.

Não se adivinha quando o receptor é sabidamente de fora do projeto (`X[]`, `Map`, `console`, `res.status().json()`). Função passada como valor, como `app.post('/x', auth, ctrl.create)`, vira aresta `references`, que não conta para ciclos. Callback anônimo no topo do arquivo vira símbolo próprio, como `app.post('/checkout')`.

`shieldepy graph <pasta>` mede a qualidade do mapa:
- **cobertura:** % das chamadas internas provadas, por heurística ou sem alvo;
- **pontos fracos** por arquivo;
- **saída** em JSON determinístico (`--json`/`--out`, ids relativos e `contentHash`), com o grafo de código, os baldes de regras e as colisões.

Esse artefato é a entrada das próximas etapas (veja `PLANO-CHAOS.md` na raiz).

`--html mapa.html` gera um visualizador interativo autocontido: Cytoscape.js com o layout `fcose`, embutidos, sem CDN, e abre offline. Ele serve para **conferir o mapa**:
- símbolos agrupados por arquivo, arestas por tipo e heurísticas destacadas;
- busca e pontos fracos clicáveis;
- clique num nó para ver **"Cadeia abaixo"** (tudo que ele alcança, como rota → banco) e **"Quem chega aqui"**, em camadas;
- link direto pela URL: `mapa.html#fluxo=src/routes/checkout.ts`.

### Topologia: rotas e operações de I/O

`shieldepy topology <pasta>` (e, na extensão, **ShielDepy: Exportar Topologia**, que grava
`.shieldepy/topology-graph.json`) lê o mapa acima e responde: *o que cada rota HTTP faz no banco
e em APIs externas, e em que ordem?*

```text
● POST /checkout   handlers: express.json() → validateCheckout → checkoutController.create
   1 db_read    stock              src/repositories/StockRepository.ts:7   (pg)
   2 api_call   api.stripe.com     src/gateways/StripeGateway.ts:8         (fetch, sem timeout)
   3 db_write   stock              src/repositories/StockRepository.ts:12  (pg)
   4 db_write   orders             src/repositories/OrderRepository.ts:14  (pg)
    tags: external-io, no-timeout, no-transaction(stock), read-then-write(stock), write-after-api-call(orders,stock)
```

Tudo é decidido pelo **pacote para o qual a chamada resolveu** no grafo, nunca pelo nome:
- **Rota:** `.get/.post/...` num valor que vem de `express`, com path literal. Os prefixos de
  `app.use('/api', router)` são compostos seguindo `router` até onde ele é declarado (import,
  barrel). Middlewares de `use` entram na cadeia só se foram registrados antes da rota.
- **Banco:** `query` de `pg`, com o SQL classificado pelos tokens (verbo, tabela, `FOR UPDATE`,
  `BEGIN`); operações do Prisma (`prisma.order.create`).
- **API externa:** `fetch` global (ou de `node-fetch`/`undici`) e `axios`, com o host da URL e o
  timeout em três estados (`yes`/`no`/`unknown`).
- **Ordem:** handlers em ordem e, dentro de cada função, as chamadas na ordem em que terminam
  (`a(b())`: `b` primeiro), em profundidade até a operação.
- **Tags:** `external-io`, `read-then-write`, `multi-write-same-target`, `write-after-api-call`,
  `no-timeout`, `no-transaction`. Cada operação sai `proven` ou `heuristic` (se o caminho passou
  por uma aresta por nome).

`--surface` mostra só o recorte que vai para a IA (rotas sensíveis e colisões, com
`arquivo:linha`, sem código). `--html` abre o visualizador com as rotas e as operações como nós
(`rotas.html#rota=POST /checkout` abre o fluxo da rota). O JSON é canônico, com hash, e aponta
para o hash do mapa de onde saiu.

### Testes de caos gerados pela topologia

`shieldepy chaos <pasta>` transforma a topologia em testes de caos para as rotas sensíveis, roda
esses testes com o Vitest do projeto e serve de portão de PR. O pipeline é um grafo do LangGraph (`@shieldepy/agent/chaos`):

1. **Threat Modeler** (IA, tier `deep`, ou o motor offline): recebe só a superfície de ataque, sem
   código, e propõe hipóteses do catálogo (`race_condition`, `timeout`, `http_5xx_intermittent`,
   `malformed_response`, ...). O motor gera a lista-base pelas tags; **a IA não tira nada dela**, só
   explica, prioriza e acrescenta, e o que ela inventa (rota, falha ou alvo) é descartado.
2. **Especialistas Network e Concurrency** (IA, tier `fast`): preenchem uma spec validada
   (atraso, status, corpo inválido, requisições em paralelo, invariantes). A IA **não escreve código**.
3. **Templates**: cada spec vira um `.spec.ts` (Vitest + supertest + MSW) com um bloco de
   **controle** (a mesma requisição, sem caos) e o de **caos**.

O projeto declara o contrato em `shieldepy.chaos.config.ts`, que o ShielDepy lê pela AST, sem executar:

```ts
export default {
  createApp,                                   // o app sem abrir porta
  setupFiles: ['chaos/setup.ts'],              // ex.: o banco vira PGlite em memória
  async reset() { /* estado limpo antes de cada teste */ },
  invariants: { async stockNeverNegative() { /* ... */ } },
  apis: { 'api.stripe.com': () => ({ id: 'ch_test', status: 'succeeded' }) }, // resposta saudável
  requests: { 'POST /checkout': { path: '/checkout', body: { /* válido */ } } },
};
```

No `examples/checkout-express`, os 4 testes de caos falham (corrida no estoque, Stripe sem
timeout, e a rota pendurada com 5xx ou corpo inválido), enquanto os controles passam. No
`examples/checkout-express-fixed`, tudo passa.

**Execução e portão.** O comando roda os testes gerados e classifica cada hipótese:
- **achado:** o controle passou e o caos falhou;
- **aguentou:** os dois passaram;
- **inválido:** o controle falhou ou o arquivo não carregou. Não conta no portão.

A severidade sai do motor: corrida ou estado corrompido é Crítico; rota pendurada ou 500 é Alto; status inesperado é Médio. Os códigos de saída são:
- **exit 1:** há achado com severidade `--fail-on` ou pior (sem `--fail-on`, qualquer achado);
- **exit 2:** erro de ambiente (o Vitest não rodou, ou todos os testes saíram inválidos).

O `--report chaos-report.md` grava o relatório em markdown para o resumo do CI e o comentário do PR. Ele traz:
- a tabela de achados com a invariante violada;
- as operações da rota com `arquivo:linha`;
- o custo da IA e o hash da topologia;
- um parágrafo explicativo, escrito pela IA ou, sem ela, pelo motor.

O workflow deste repositório fica em `.github/workflows/shieldepy-chaos.yml`, e o guia para um repositório-alvo em [`docs/chaos-ci.md`](docs/chaos-ci.md). Use `--no-run` para só gerar os testes.

**Só o que o PR tocou.** `--base <ref>` monta o mapa no merge-base com o ref (num `git worktree` temporário) e testa só as rotas sensíveis que o PR tocou: rota nova, cadeia de handlers, operações, tags, corpo de qualquer função no caminho ou código de topo de um arquivo do caminho. Mudança de config, dependência ou setup faz todas entrarem. Isso só funciona porque os ids de símbolo são estáveis (`arquivo#Contêiner.nome`, sem a linha) e cada símbolo tem um hash do corpo pela AST, que ignora comentários e espaço. `shieldepy diff <pasta> --base <ref>` mostra o diff de estrutura sozinho: símbolos novos, removidos, renomeados e com corpo alterado.

## Mapa do código

As dependências andam numa direção só:

```
apps/vscode   apps/cli   apps/frontend   ← interfaces (só aqui existe `vscode`, http, argv)
      └───────────┼───────────┘
                  ▼
      packages/agent   packages/extractors   ← IA plugável · tradutores código → regras
                  └───────┬────────┘
                          ▼
                    packages/core           ← motor puro: sem vscode, sem rede
```

| Quero mudar… | Onde fica |
|---|---|
| Como uma colisão é detectada | `packages/core/src/interactions/detector.ts` |
| O formato de uma regra (`Rule`, `Collision`) | `packages/core/src/interactions/model.ts` |
| Como o grafo de imports e chamadas é mantido | `packages/core/src/code-graph/CodeGraph.ts` |
| O que é lido de um arquivo TS/JS (funções, chamadas, tipos do receptor) | `packages/core/src/code-graph/extract-ts.ts` |
| Imports/exports/re-exports de um arquivo (tabela de módulo) | `packages/core/src/code-graph/extract-module.ts` |
| Resolução de especificadores (relativo, tsconfig `paths`, pacote) | `packages/core/src/code-graph/resolve-import.ts` |
| Artefato do mapa do sistema (`shieldepy graph`) | `packages/core/src/system-graph.ts` |
| Rotas, operações de I/O, tags e superfície de ataque (`shieldepy topology`) | `packages/core/src/topology/*` |
| SQL por tokens (triggers e `pool.query`) | `packages/core/src/sql/*` |
| Contrato `shieldepy.chaos.config.ts` lido pela AST | `packages/core/src/chaos-config.ts` |
| Catálogo de falhas, hipóteses, Threat Modeler, especialistas, templates e grafo LangGraph | `packages/agent/src/chaos/*` |
| Tokens e custo de cada chamada à IA | `packages/agent/src/cost.ts` |
| Comando `shieldepy chaos` | `apps/cli/src/chaos.ts` |
| Rodar o Vitest do alvo e classificar controle × caos | `apps/cli/src/chaos-run.ts` |
| Severidade dos achados e portão; relatório markdown do PR | `packages/agent/src/chaos/results.ts`, `report.ts` |
| Workflow do GitHub Actions (e o modelo para repositórios-alvo) | `.github/workflows/shieldepy-chaos.yml`, `docs/` |
| Id estável de símbolo e hash do corpo/topo pela AST | `packages/core/src/code-graph/extract-ts.ts` (`stableIds`), `fingerprint.ts` |
| Diff entre mapas e rotas tocadas por um PR | `packages/core/src/map-diff.ts`, `topology/affected.ts`; base pelo git em `apps/cli/src/git-base.ts` |
| Visualizador do mapa (CLI `--html` e painel da extensão) | `packages/viewer/src/index.ts` (bibliotecas em `libraries.json`) |
| O que é lido de HTML/CSS (AST Tree-sitter) | `packages/core/src/code-graph/extract-web.ts` |
| Como um handler TS/JS vira regra | `packages/extractors/src/treesitter/event-handlers.ts` |
| Suporte a Java / Python / C# | `packages/extractors/src/treesitter/*` (gramáticas em `packages/core/wasm`) |
| Triggers do Postgres (PL/pgSQL) | `packages/extractors/src/postgres/*` (tokenizador em `lexer.ts`) |
| Qual extrator atende qual extensão de arquivo | `packages/extractors/src/registry.ts` |
| Claude ou Gemini (chamada HTTP, modelo, retry) | `packages/agent/src/providers/*` |
| Texto dos prompts | `packages/agent/src/code/prompts.ts`, `packages/agent/src/collisions/prompt.ts` |
| Explicação sem IA | `packages/agent/src/collisions/offline.ts` |
| Quando a extensão analisa um arquivo | `apps/vscode/src/analysis/BackgroundAnalyzer.ts` |
| Como os achados aparecem no editor | `apps/vscode/src/analysis/FindingsManager.ts` |
| O estado do workspace (grafo + regras + colisões) | `apps/vscode/src/workspace/WorkspaceModel.ts` |
| Chat, painel, configurações (lado da extensão) | `apps/vscode/src/chat/`, `apps/vscode/src/views/` |
| Chat, painel, configurações (HTML/CSS/JS da tela) | `apps/vscode/media/webview/` |
| Comandos da paleta | `apps/vscode/src/commands.ts` (registro em `extension.ts`) |
| Nomes de settings e comandos | `apps/vscode/src/config.ts`, `apps/vscode/src/constants.ts` |

### Convenções

- **Nomes de arquivo**: `PascalCase.ts` quando o arquivo exporta uma classe (`CodeGraph.ts`,
  `FindingsManager.ts`); `kebab-case.ts` para o resto (`extract-ts.ts`, `path-guard.ts`).
- **Idioma**: identificadores em inglês; comentários, mensagens e textos da interface em português.
- **Comentários** explicam o **porquê** (a decisão, o bug que evitam), não o que a linha faz.
- **Módulos puros primeiro**: o que dá para escrever sem `vscode`, rede ou disco fica fora dos
  apps e é testado direto (`WorkspaceModel`, `verify-fix`, `excerpt`, `FindingsCache`).
- **Linhas são 0-based** em todo o código; o +1 só acontece na hora de mostrar para humanos.
- **Um arquivo = uma responsabilidade**: o maior é o `CodeGraph.ts` (~500 linhas), a manutenção
  incremental do grafo, que não se divide bem.

### Como estender

**Nova linguagem** (ex.: Go):
1. Inclua a gramática (`tree-sitter-go.wasm`, do `tree-sitter-wasms`) em `packages/core/scripts/copy-wasm.cjs` e em `GrammarName` (`packages/core/src/code-graph/parser.ts`).
2. Crie `packages/extractors/src/treesitter/go.ts`, que percorre a AST e devolve `ParsedRule[]`. Nada de regex sobre o texto.
3. Registre em `registry.ts` (`createRegistry`/`loadRegistry`).
4. Adicione uma pasta em `examples/` com as mesmas colisões plantadas do sistema de pedidos. O teste de cenário
(`packages/extractors/test/scenarios.test.ts`) já cobre a nova stack se você acrescentar uma linha.
Na extensão, inclua o `languageId` em `apps/vscode/src/constants.ts`.

**Nova IA**: implemente `LLMProvider` (um método `complete`) em `packages/agent/src/providers/` e
inclua na escolha em `packages/agent/src/select.ts`.

---

## Rodar e testar

```bash
npm install
npm run check                 # typecheck + testes unitários/integração (vitest)
npm run build:vscode          # gera apps/vscode/dist e copia os .wasm
npm run test:e2e -w shieldepy # abre um VS Code DE VERDADE e testa a extensão ponta a ponta
```

**Extensão**: abra esta pasta no VS Code e aperte **F5**. Abre uma janela nova com `examples/`.
Em `pedidos-microservices/services`, `pricing` e `tax` devem ficar marcados em vermelho
(write-write em `total`) e `audit` em amarelo. Para ligar a IA: **ShielDepy: Configurar Chave da IA**.

**CLI** (`npm run cli -- <comando>`):

```bash
npm run cli -- report  examples/pedidos-spring/services        # só o motor
npm run cli -- explain fixtures/postgres-example.json          # motor + IA (ou offline)
npm run cli -- report  <pasta> --fail-on critico               # portão de CI: sai com 1
npm run cli -- cycles  <pasta>                                 # ciclos de chamada
npm run cli -- graph   <pasta> [--json] [--out mapa.json]      # mapa do sistema + cobertura
npm run cli -- graph   <pasta> --html mapa.html              # visualizador interativo (offline)
npm run cli -- topology <pasta> [--json] [--surface] [--out .shieldepy/topology-graph.json] [--html rotas.html]
                                                               # rotas, I/O em ordem e tags de risco
npm run cli -- diff    <pasta> --base origin/main [--json]     # o que mudou na estrutura do código desde o merge-base
npm run cli -- chaos   <pasta> [--offline] [--fail-on alto] [--report chaos-report.md] [--base origin/main]
                                                               # gera, roda os testes de caos e serve de portão
                                                               # (--no-run: só gera em .shieldepy/chaos-tests/)
npm run cli -- report  --pg postgres://user:pass@host/db       # triggers de um Postgres real
```

**Web** (`apps/frontend`: React + Vite em `src/`, servidor Node em `server/`):

```bash
npm run web:dev   # desenvolvimento: Vite com hot reload em http://localhost:5173 (API em :3001, via proxy)
npm run web       # produção: build (landing pré-renderizada + portal) e servidor em http://localhost:3001
```

A landing (`src/landing`) sai do build já renderizada em HTML e o React só hidrata; o portal
(`src/portal`: login, projetos, equipe, conta, plataforma, ferramenta) é um SPA com React Router.
Os endereços antigos (`/login.html`, `/project.html?id=…`) redirecionam para as rotas novas.

Chaves para a CLI e a web: copie `.env.example` para `.env`.

### O que os testes cobrem

- **199 testes** (vitest), cobrindo:
  - o motor
  - a resolução do grafo (imports, tipos do receptor, interfaces, ordem de indexação)
  - todos os extratores, incluindo os 4 stacks de exemplo
  - a IA com provedores falsos (sem rede)
  - o modelo do workspace, a verificação de correções e o cache
  - a CLI e o servidor web (HTTP de verdade)
- **E2E da extensão** (`test-e2e/`): num VS Code real, confere que a extensão:
  - ativa e registra os comandos
  - mostra as colisões nas duas pontas e não acusa o controle
  - acha o ciclo
  - desfaz a colisão ao vivo quando o código é editado
  - gera o relatório offline

---

## Histórico: o que mudou em relação aos projetos originais

Itens do `PLANO_DE_CORRECOES.md` da extensão original (pasta `legado_grafo_arvore/`, hoje só no histórico do git) resolvidos durante a fusão:

| Item | Como ficou |
|---|---|
| 2.1 vazamento de `Tree` | `tree.delete()` em todo parse (`TsParser.withTree`) |
| 2.2 ciclo copiado 3× | `CodeGraph.cyclesInFile` / `allCycles` |
| 2.3 verifyFix no grafo real | `WorkspaceModel.fork()`: a simulação roda numa cópia |
| 2.4 análise duplicada | só o analyzer reindexa; a mesma versão do documento não é reanalisada |
| 3.1 diff/virtual disparando IA | `isAnalyzable`: só `file:`, fora de node_modules, até 2 MB |
| 3.2 inline em `**` | só linguagens de código, `scheme: file` |
| 3.3 cancelamento | `AbortSignal` até o HTTP (Anthropic e Gemini) |
| 3.4 applyFix fora do workspace | `resolveInsideWorkspace`; o conteúdo do fix não passa pelo webview |
| 3.5 webview sem CSP | CSP com nonce, assets em `media/webview`, só `textContent` |
| 3.6 histórico sem limite | `trimHistory` (turnos + caracteres) |
| 3.7 concorrência | no máximo 2 chamadas de IA simultâneas |
| 4.1 debounce global | debounce por arquivo |
| 4.2 id baseado na frase da IA | `Finding.key` (ancorado na linha de código) |
| 4.3 cache sem poda | resolvidos há mais de 30 dias saem; teto de 5000 |
| 4.4 Enter aceita ghost text | keybinding removido |
| 5.1–5.4 estrutura | `config.ts`/`constants.ts`, comando `attachFinding`, `parseFixedFile` único, `media/` |

Do Projeto18:
- validação de `Rule[]`
- allowlist de exemplos na web (o navegador não abre mais conexão com banco)
- JSON inválido → 400, não 500
- sessões com expiração e limite, rate limit
- registro único de linguagens
- duplicação `node-events`/`shared` removida
- Python aceita outro nome para a instância; C# escapa o tipo do evento

## Limites conhecidos

- PL/pgSQL é lido por tokens (não há gramática Tree-sitter dele): SQL dinâmico (`EXECUTE`) e
  colunas mexidas em funções chamadas pelo trigger não são seguidos.
- Sem a gramática `.wasm` de uma linguagem, os arquivos dela são ignorados (não há leitura aproximada).
- `condition` das regras não é avaliada: regras que nunca rodam juntas ainda aparecem como colisão.
- O grafo não infere tipo sem anotação além de `new X()` e retornos anotados. `const x = f()`
  com `f` sem tipo de retorno, ou um campo atribuído a partir de uma chamada, caem no fallback
  por nome (aresta `heuristic`). `require` com caminho dinâmico não é seguido.
- Topologia: só Express (NestJS, Fastify e rotas por arquivo do Next.js ainda não), e só
  `pg`/Prisma/`fetch`/`axios` como I/O. Ficam de fora `router.route('/x').get(...)`, roteador
  recebido como parâmetro (sai sem o prefixo de quem chama), SQL que não é literal
  (`db_unknown`) e chamadas dentro de callbacks passados a funções (`prisma.$transaction(async (tx) => ...)`:
  o `tx` não tem tipo, então as operações de dentro não aparecem).
- Caos: só falhas de rede e de concorrência têm teste. Falha no banco depois da chamada externa
  (`partial_failure_after_external_call`) e `retry_storm` aparecem como hipótese, mas sem teste. Host
  de API dinâmico (URL montada em runtime) não gera teste de rede, porque não se sabe o que interceptar.
- O painel, o chat e as configurações são testados no E2E só indiretamente (via comandos e
  Diagnostics), não clicando na interface.
