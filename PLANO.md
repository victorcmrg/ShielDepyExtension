# Plano — ShielDepy

O que está sendo feito agora e o que falta. É curto de propósito: as decisões tomadas ficam em [`docs/decisoes/`](docs/decisoes/), o registro de cada tarefa é o commit, e o histórico das etapas antigas (E1–E6, V, R, Q, M, L, J) está em [`docs/historico/`](docs/historico/), só para consulta.

## Como retomar num chat novo

1. O `CLAUDE.md` tem os combinados e os comandos.
2. Ler "Onde estamos" e a etapa em andamento, mais abaixo.
3. Ler as decisões que a etapa cita, em [`docs/decisoes/`](docs/decisoes/README.md).
4. Rodar `git log --oneline -15` para ver as últimas tarefas feitas.

## Onde estamos (2026-11-02)

- **Branches (conferido em 2026-11-02, depois da restauração de fábrica):** a `main` (e a `origin/main`) parou em `2057cfa` (2026-10-30) e não tem nem o MVP nem a D. O trabalho depois disso está em duas branches no GitHub, `feat/mvp-caos` (MVP1 a MVP9, `8fba706`) e `feat/dataset-d` (D1 a D7, `3445245`). A `integra/mvp-e-dataset` (local, sem push) junta as duas. Os conflitos foram só de "as duas valem": os campos `harnessDir` e `dataset` em `ChaosArgs`, as dependências da `apps/cli` (o arnês do MVP mais o `pg` da D), o índice das decisões e este plano. Com ela, o `npm run check` dá **520 passando, nenhum pulado**. Os exemplos `checkout-*` precisam do `npm install` deles, senão os 10 testes de caos de ponta a ponta são pulados. O `backup/2026-11-02-dataset-d-wip` tem a mesma árvore da `feat/dataset-d` (nada se perdeu), e ele e o `backup/c2d2-antes-do-rebase` podem ser apagados no GitHub (perguntar). **Falta o usuário pedir** o merge na `main` e o push.
- **Esta máquina:** Node 22.23.4 (o do CI) instalado pelo winget em 2026-11-02; a worktree `../ShielDepy-dataset` não existe mais.
- **Agora: o MVP de demonstração** ([0018](docs/decisoes/0018-mvp-caos-e-frameworks.md), escolha do usuário em 2026-10-31): o caos utilizável de ponta a ponta e em mais frameworks, com um roteiro sólido; a parte da empresa fica mockada. Licença, cobrança, deploy e o lançamento mínimo ([0017](docs/decisoes/0017-lancamento-minimo.md)) ficam parados. A etapa e as tarefas estão na seção **MVP**, mais abaixo. Branch: `feat/mvp-caos`, a partir da `main` em `2057cfa`.
- **MVP1 ✅** (2026-10-31, na `feat/mvp-caos`): o banco de teste do Prisma (C2d2) portado para a C2a nova, com a decisão [0019](docs/decisoes/0019-banco-de-teste-prisma-pelo-socket.md). Conferido de novo no realworld (os 4 achados da C1 em 3 rodadas) e no prisma-express (esquema pelo `migrate diff`, o mesmo "aguentou" da C1 e a perda de atualização inteira numa sonda). A branch local `backup/c2d2-antes-do-rebase` já pode ser apagada.
- **MVP2 ✅** (2026-10-31): o arnês embutido ([0025](docs/decisoes/0025-arnes-de-teste-embutido.md)). Sem Vitest, supertest, MSW ou PGlite no projeto, a CLI empresta os dela por links em `.shieldepy/chaos-tests/node_modules`, sem instalar nada no alvo. Conferido num `checkout-express` só com `express` e `pg`: os mesmos 6 achados. **Falta na extensão** (o bundle não leva o Vitest): decidir depois se o `.vsix` leva o arnês ou se ele é baixado na primeira execução.
- **MVP3 ✅** (2026-10-31): com Fastify, Koa, Hono, Next.js, hapi ou Restify no `package.json` e 0 rotas no mapa, o caos avisa e sai 2 (nada provado), em vez de 0.
- **MVP4 ✅** (Fastify, 2026-10-31; decisão [0026](docs/decisoes/0026-fastify-createapp-pelo-handler.md)), em três fatias: **MVP4a ✅** as rotas no mapa; **MVP4b ✅** o app e o `createApp` do `--init`; **MVP4c ✅** os exemplos `checkout-fastify` e `checkout-fastify-fixed` com os testes de aceitação. A ordem recomendada e o que o chat pode fazer sem o usuário estão em **"Para o próximo chat"**, logo abaixo.
  - **MVP4c ✅**: `examples/checkout-fastify` é o mesmo checkout do `checkout-express` (o domínio copiado), em Fastify: plugin tipado registrado com `prefix: '/api'`, `preHandler` de validação nas opções da rota e um `route({...})`. Só tem `fastify` e `pg` (o arnês é o da CLI, MVP2). O contrato saiu do `--init` com 3 pendências óbvias (o esquema SQL, a resposta do Stripe e o corpo do POST) e o `createApp` sem pendência; as invariantes são as do Express. Resultado: os mesmos 6 achados, exit 1; o `-fixed` (o domínio do `checkout-express-fixed`) dá 4 aguentou e 1 inválido, exit 0, como o do Express. Testes: a topologia dos dois exemplos em `fastify.test.ts`, o caos dos dois em `cli.test.ts` (pulados sem o `npm install` deles) e o modo `capture` de verdade em `chaos-app-fastify.test.ts` (ESM e CommonJS, a porta continua livre).
  - Limite visto no caminho: o handler escrito dentro de um `route({...})` num plugin não vira símbolo (é um callback dentro de função), então o `GET /api/orders/:id` sai sem a leitura. Vale também para o Express com a rota registrada dentro de função. Não afeta as rotas sensíveis do exemplo.
  - **MVP4a ✅** (2026-10-31): `fastifyRoutes` em `topology/routes.ts`. Rota é verbo ou `route({ method, url, handler })` numa instância do pacote `fastify` (a de `Fastify()` ou o parâmetro tipado `FastifyInstance`); o plugin sem tipo só conta se alguém o registra. O `register(plugin, { prefix })` monta como o `use` do Express (inclusive o callback escrito ali), e os hooks antes do handler (`addHook('preHandler', …)` e `preHandler`/`onRequest`/`preValidation` nas opções) entram na cadeia. O extrator passou a guardar os valores de objeto que são nome, função ou lista (`values`) e o primeiro parâmetro de um callback (`param`). O Fastify saiu da lista de "não suportado" da MVP3. Fora: o plugin embrulhado (`fp(...)`, `register(import(...))`) sai em `skipped`.
  - **MVP4b ✅** (2026-10-31): o `RouteScan.apps` acha também o `Fastify()` raiz (`framework: 'fastify'`), com os mesmos modos da C2a. No contrato, o `createApp` devolve `fastifyHandler(app)`: um `(req, res)` que espera o `ready()` e chama o `app.routing(req, res)` (API pública do Fastify), então o supertest e os templates não mudam. No modo `capture`, o `chaos/setup.ts` troca o `fastify` (no `vi.mock` e no cache do `require`) por um que guarda a instância e cujo `listen()` não abre porta. Conferido só por teste unitário; rodar de verdade é a MVP4c.
  - Na suíte inteira da MVP4a, o teste "MVP2: sem o arnês no projeto…" travou ~21 min e falhou (sozinho, 18 s); na da MVP4c passou (494 verdes). Instabilidade sob carga, a observar.
- **MVP6 ✅** (corpos mínimos, 2026-10-31; decisão [0027](docs/decisoes/0027-corpo-de-exemplo-sem-pendencia.md)): o extrator anota em cada função o que ela lê de `req.body` (`bodyReads`: acesso direto, desestruturação, apelido, `(req.body ?? {}) as X`), e o `--init` junta o que a cadeia da rota lê e escreve um corpo de exemplo com valores pelo nome (`chaos-body.ts`). A linha sai sem a marca de pendência ("confira os valores"): quem diz se o corpo vale é o controle do teste gerado. Num `checkout-express` limpo, o `--init` caiu de 4 para 3 pendências (o esquema, a resposta do Stripe e o parâmetro do `GET`), e com o corpo gerado, sem editar, o caos achou os mesmos 6 problemas com os controles passando. **MVP6b ✅** (nos projetos da C1): o corpo também segue um nível para dentro (o handler passa `req.body.article`, `{ ...req.body.user }` ou o `req.body` inteiro a um serviço, e vale o que o serviço lê daquele parâmetro, pela chamada resolvida no grafo); o campo usado como lista (`posts?.map()`, `.length`) sai `[]`; e a rota cujos handlers do projeto não leem nem repassam o corpo sai `body: {}` sem a marca ("sem corpo"). Pendências do `--init` na C1 → agora: pg-crud 10 → 7, realworld 17 → 11, prisma-express 9 → 6; as que sobram são o esquema e os parâmetros de rota. Fora (depois do MVP): zod/joi, o tipo do `req.body`, o DTO do Nest, e mais de um nível de chamada.
- **MVP8 ✅** (2026-10-31): a tabela em [`docs/pesquisa/mvp-resultados.md`](docs/pesquisa/mvp-resultados.md): os 4 exemplos (Express e Fastify, com os `-fixed`), os 3 projetos da C1 e 2 novos (fastify-prisma e nest-realworld). Achados verdadeiros 17, falsos 0, todos com o controle passando. O pg-crud rodou de novo de ponta a ponta (o mesmo achado da C1, com app, banco e corpos gerados); o realworld e o prisma-express só no `--init` (rodaram inteiros na MVP1). **Achado no caminho e corrigido:** o fastify-prisma registra as rotas num laço (`for (const r of Object.values(routes)) app.route(r)`), o mapa dá 0 rotas, e como a MVP4 tirou o Fastify da lista da MVP3 o caos saía 0, um verde falso. Agora, com Express, Fastify ou NestJS nas dependências e 0 rotas, ele avisa e sai 2 (`supportedFrameworks`). Seguir o laço fica como próxima fatia do Fastify.
- **MVP9, parte sem o usuário ✅** (2026-10-31): o [`docs/roteiro-mvp.md`](docs/roteiro-mvp.md) (Express ao vivo na extensão; Fastify pela CLI, porque na extensão o caos usa o Vitest do projeto e o `checkout-fastify` não tem: DP8; a tabela da MVP8 em slide; o portal) e o `demo:verificar` com o passo do Fastify pela CLI no fim. O `npm run demo:verificar:cli` roda só esse passo, sem VS Code nem portal: conferido (o vulnerável sai 1 com 6 achados, o corrigido sai 0). **`npm run demo:verificar` inteiro conferido em 2026-11-02** (VS Code de teste 1.144, passos 0 a 6 e os dois Fastify), depois de corrigir duas coisas que ele achou: a pasta da demo com o `node_modules` apontando para o caminho antigo do repositório (agora é recriada) e o vigia de arquivos da extensão, que indexava os testes gerados em `.shieldepy/` e os punha no mapa e na comparação com a branch. O ensaio pula o histórico do portal (`--sem-historico`) e não instala pelo `.vsix`: isso e o ensaio com a janela de verdade ficam para o usuário.
- **DP7 respondida** (2026-11-02, decisão [0028](docs/decisoes/0028-demo-so-o-motor-e-nest-fora.md)): a demo é o motor, sem compra, download nem login liberando a extensão; a empresa é uma tela real do portal com dados simulados (MVP7, destravada). O NestJS (MVP5) saiu do critério de pronto e fica opcional, para o usuário pedir depois.
- **Esperando o usuário:** a DP8 decide o arnês na extensão (com ela, o Fastify também roda pelo botão); não bloqueia a demo.

### Para o próximo chat (atualizado em 2026-10-31, fim da 2ª sessão do MVP)

**Feito nesta sessão** (já no GitHub, ainda fora da `main`; branch `feat/mvp-caos`): MVP4 (Fastify, a/b/c), MVP6 e MVP6b (corpos), MVP8 (tabela, com a correção do verde falso) e a parte da MVP9 que não precisa do VS Code. Decisões técnicas novas: [0026](docs/decisoes/0026-fastify-createapp-pelo-handler.md) e [0027](docs/decisoes/0027-corpo-de-exemplo-sem-pendencia.md).

**A demo do TCC** ([0028](docs/decisoes/0028-demo-so-o-motor-e-nest-fora.md)): o motor, contado numa história só. O passo a passo está no [`docs/roteiro-mvp.md`](docs/roteiro-mvp.md): (1) Express ao vivo na extensão, (2) o mesmo em Fastify, pela CLI ou em vídeo, (3) a tabela da MVP8 em slide, (4) o portal local com o histórico e a página simulada de plano e faturas. Gravar um vídeo como plano B.

**O que falta, em ordem:**
1. **Sem o usuário:** corrigir o relatório da MVP8 (os 17 achados são 12 de defeitos plantados nos exemplos e 5 de projetos reais; o texto diz que todos foram conferidos na C1, o que não vale para os do `checkout`).
2. **Sem o usuário:** seguir as rotas do Fastify registradas num laço (`for (const r of Object.values(routes)) app.route(r)`, o fastify-prisma real) e testar de novo nele: até agora o caos só achou problemas em Fastify no nosso exemplo. O Express já segue o `forEach` sobre uma lista literal (`site.loop` e `CodeGraph.arrayItems`); falta o `for...of` e o `Object.values` de um objeto literal.
3. **Sem o usuário:** preencher os parâmetros de rota (`:id`, `:slug`) com os registros do `reset`. É o que mais falta para o critério de pronto: hoje as pendências do `--init` são 3 no `checkout-express`, 7 no pg-crud, 11 no realworld e 6 no prisma-express, e o critério pede 1 ou 2.
4. **MVP7:** a página de plano e faturas simulada (o screenshot pede o Chrome, perguntar antes).
5. **Com o usuário:** um ensaio do roteiro, a resposta da DP8 e o vídeo de plano B.
6. **Fechamento, quando o usuário pedir:** juntar a `feat/mvp-caos` e a `feat/dataset-d` na `main` e fazer o push. A branch local `backup/c2d2-antes-do-rebase` já pode ser apagada (perguntar).

**Opcional, se o usuário pedir:** MVP5 (NestJS: o mapa já lê as 21 rotas do nest-realworld; falta o `createApp` pelo `NestFactory`, seguindo a 0026: entregar ao supertest a função do adapter depois do `init()`).

**Como trabalhar:** uma fatia por commit, com o `npm run check` verde. Push e merge só quando o usuário pedir, e sem decidir a DP8. Uma coisa pesada por vez. Os números de decisão 0020 a 0024 são da D (ela usou a 0020); o MVP está na 0028. O merge com a D já foi feito na `integra/mvp-e-dataset` (2026-11-02).

- **Pronto:** o motor (mapa, topologia e caos em JS/TS; mapa, rotas e I/O em C# e Java), a extensão, a CLI, o portal com o histórico do caos e a demo do TCC. Como funciona: [`docs/como-funciona.md`](docs/como-funciona.md).
- **Reorganização de 2026-10-23** ([0014](docs/decisoes/0014-organizacao-do-repositorio.md)) ✅: o monorepo virou a raiz, as decisões viraram arquivos e o plano encolheu. Está na `main`, e as branches antigas do GitHub foram apagadas.
- **Etapa S ✅** (S1 a S7) e **P1 ✅** (Postgres com Drizzle, decisão [0015](docs/decisoes/0015-drizzle.md)): na `main` desde 2026-10-24 (`9d0bc55`, merge fast-forward da `feat/postgres-drizzle`). A `apps/api` é `shared/` + `domains/{identity,companies,projects,chaos-runs}` + `composition.ts`, sobre Postgres/PGlite. Noutra máquina: `git pull` na `main` e `npm install` na raiz. Se aparecer uma pasta `shieldepy_p1/` não rastreada, é resto do layout antigo e pode ser apagada.
- **Em andamento: etapa C**, na `main`. **C1 ✅** (2026-10-24): o caos rodou nos 3 projetos reais; resultado e lista para a C2 em [`docs/pesquisa/caos-projetos-reais.md`](docs/pesquisa/caos-projetos-reais.md). **C2 em andamento:** C2d1 ✅ (banco de teste gerado para o `pg`). A C1 e a C2d1 estão na `main` desde 2026-10-30 (`8dda696`, merge fast-forward da `feat/caos-c1`; as branches já mergeadas foram apagadas no GitHub). **C2a ✅** (2026-10-30, na `main` desde `c2e75e0`): o `--init` escreve o `createApp` sem editar o projeto, e nos 3 projetos da C1 saiu sem pendência (resultado na seção 6 do relatório da C1). O resto da C2 seguiu para o MVP (a C2d2 virou a MVP1).
- **Nova frente, D (2026-10-30): dados para a equipe que treina a IA de erros de produção** ([0016](docs/decisoes/0016-dados-para-treino.md)). Feita na branch `feat/dataset-d` (a partir da `main` em `2057cfa`; junta com o MVP na `integra/mvp-e-dataset`): **D1 ✅ D2 ✅ D3 offline ✅ D4 ✅ D5 ✅ D6 ✅ D7 ✅** (35 registros, 19 pares; o guia é o [`docs/dataset.md`](docs/dataset.md)). Com a variável `SHIELDEPY_DATASET_DATABASE_URL`, cada `chaos` já grava no Neon da equipe de IA ([0020](docs/decisoes/0020-dataset-direto-no-neon.md)), conferido de verdade em 2026-10-31 (o corpus está lá). Falta também: a equipe trocar as chaves que vieram no chat, o realworld e o prisma-express no corpus (a MVP1 já está junto na `integra/mvp-e-dataset`, então dá para fazer), e a D3 com IA (DP6). Os 19 pares do DPO estão na `shieldepy_dpo_pairs` ([0021](docs/decisoes/0021-pares-dpo-no-neon.md)). Está no GitHub na `feat/dataset-d`, fora da `main`. Corre em paralelo à C e não mexe na `apps/api` nem na `apps/web` (o full stack da empresa segue noutra sessão).
- **Falta conferir num VS Code real** (perguntar antes): o E2E da L e da J, e o device flow da extensão contra a `apps/api`.
- **Parte da empresa: parada até o fim do MVP** ([0018](docs/decisoes/0018-mvp-caos-e-frameworks.md)); o que a [0017](docs/decisoes/0017-lancamento-minimo.md) tinha decidido vale para depois. Nada de full stack completo agora. O **degrau 1** põe o site estático no ar e a extensão no Marketplace e no Open VSX, sem servidor; o **degrau 2** põe o portal e a API no ar para os primeiros times. Licença e cobrança (A e B) ficam para quando houver quem pague. A seção "Lançamento mínimo", mais abaixo, tem a lista. Falta o usuário decidir DP4 (domínio e e-mail) e DP2 (repositório privado ou público) para o degrau 1, e DP3 (hospedagem) para o degrau 2.

## Decisões pendentes (do usuário; perguntar antes da tarefa que depende delas)

| # | Decisão | Opções | Bloqueia |
|---|---|---|---|
| DP1 | Provedor de pagamento | **Asaas**: Pix, boleto e NFS-e automática; o foco é B2B no Brasil. **Stripe**: cartão e clientes de fora | B3 |
| DP2 | Licença do código e visibilidade do repositório | MIT e repositório público, ou "todos os direitos reservados" e repositório privado. O template de CI e o `.vsix` nas Releases dependem disso | G2–G4, C4 |
| DP3 | Hospedagem da API, do site e do Postgres | Uma VPS com Docker, ou PaaS (Railway, Render, Fly) com Postgres gerenciado (Neon, Supabase) | P2 |
| DP4 | Domínio e e-mail de contato | — | P2, W |
| DP5 | O que cada plano destrava (a tabela de planos) | Ponto de partida: [`docs/pesquisa/precos-concorrencia.md`](docs/pesquisa/precos-concorrencia.md), seção 7.3 | B1 |
| DP8 | O arnês de teste na extensão | O `.vsix` leva o Vitest, o supertest e o MSW (fica maior) **ou** a extensão baixa na primeira execução. Hoje, na extensão, vale o do projeto (os exemplos já têm) | arnês na extensão |
| DP6 | Dataset do treino: gerar também com a IA (pago) e com que orçamento; quais licenças de repositório aceitar no corpus | Só offline (grátis) ou offline + IA com teto em US$; licenças permissivas (MIT, Apache-2.0, BSD) ou qualquer pública | D3 com IA, D5 |

## Etapas

Ordem: **S ✅ → P1 ✅ → MVP ([0018](docs/decisoes/0018-mvp-caos-e-frameworks.md)) → depois do MVP: lançamento mínimo ([0017](docs/decisoes/0017-lancamento-minimo.md)) → resto da C e da F → A → B → P**. A D corre em paralelo, fora do caminho do MVP.
- Desde a 0018, o que segue abaixo sobre a empresa (LM, W, G, A, B, P) está parado: fica escrito para quando o MVP acabar.
- Da empresa, só entra o que serve para distribuir o produto: o lançamento mínimo junta as partes necessárias da W, da G e da P.
- A S destrava tudo sem mudar comportamento, e a P1 (Postgres) vem logo depois da S7, que isola o banco na `infra`.
- A C e a W deixam o produto honesto e utilizável antes de alguém instalar.
- A G põe o produto na mão das pessoas, de graça.
- A A e a B só fazem sentido quando houver quem pague (validar com 5 a 10 times junto da G).

| Etapa | O que | Status |
|---|---|---|
| S | Separação produto × empresa + DDD na API ([0008](docs/decisoes/0008-produto-e-empresa.md), [0013](docs/decisoes/0013-api-ddd-por-dominio.md)) | ✅ (S1 a S7) |
| P1 | Postgres e migrations com Drizzle ([0012](docs/decisoes/0012-postgres.md), [0015](docs/decisoes/0015-drizzle.md)) | ✅ (P1a a P1c; na `main`) |
| **MVP** | **Caos utilizável em Express, Fastify e NestJS, empresa mockada** ([0018](docs/decisoes/0018-mvp-caos-e-frameworks.md)): MVP1 a MVP9, versão enxuta | **em andamento**; MVP1 a MVP4, MVP6 e MVP8 ✅, MVP9 sem o ensaio no VS Code; falta a MVP7; MVP5 opcional (branch `feat/mvp-caos`) |
| C | Motor: terminar o caos utilizável (C1 restante, C2, C2f, C4, F) | C1 ✅, C2d1 ✅, C2a ✅ (na `main`); o resto da C2 e a F rápida viraram tarefas do MVP; C4 parada |
| LM | **Lançamento mínimo** ([0017](docs/decisoes/0017-lancamento-minimo.md)): degrau 1 (site estático + marketplaces) e degrau 2 (portal e API no ar) | parado até o fim do MVP (0018) |
| W | Landing honesta | parado (0018) |
| G | Distribuição do produto (npm, Releases, Marketplace, Open VSX) | parado (0018); o `.vsix` local já existe |
| A | Licença: direito de uso por empresa ([0009](docs/decisoes/0009-modelo-de-venda.md), TDD [0011](docs/decisoes/0011-tdd-na-empresa.md)) | parado (0018) |
| B | Monetização: planos, assinatura, cobrança, cadastro (TDD) | parado (0018); no MVP, só telas mockadas (MVP8) |
| P | Produção: deploy, segurança, operação, LGPD | parado (0018) |
| D | Dados para treinar a IA de erros de produção ([0016](docs/decisoes/0016-dados-para-treino.md)) | D1 a D7 ✅ (D3 só offline) na `feat/dataset-d`; falta a D3 com IA (DP6) e o realworld e o prisma-express no corpus |
| — | Medição paga da IA (5e) | só com autorização |
| — | Python no motor ([0007](docs/decisoes/0007-linguagens.md)) | próxima linguagem; escrever a etapa aqui quando começar |
| — | Caos em C# e Java (xUnit/`WebApplicationFactory`, JUnit/Spring Test) | talvez |

---

### MVP — o caos utilizável nos frameworks, com a empresa mockada (2026-10-31)

**Por que existe:** a decisão [0018](docs/decisoes/0018-mvp-caos-e-frameworks.md). É preciso mostrar o produto funcionando de ponta a ponta antes de cuidar de licença, cobrança e produção.

**Pronto quando:** em projetos Express e Fastify (com `pg` ou Prisma; o NestJS saiu do critério na [0028](docs/decisoes/0028-demo-so-o-motor-e-nest-fora.md)), o roteiro roda sem tropeço:
1. instalar a extensão pelo `.vsix` local;
2. abrir o projeto e gerar o contrato (`--init`), deixando no máximo 1 ou 2 pendências óbvias;
3. rodar o caos e ver o achado no código, no relatório e no portal local, com as telas da empresa mockadas.

As tarefas, em ordem. Cada uma é uma fatia com teste e um commit, como sempre:

| # | Tarefa | Vem de | Estimativa |
|---|---|---|---|
| MVP1 ✅ | **Banco de teste do Prisma.** Portar o que foi feito em 2026-10-25 (branch local `backup/c2d2-antes-do-rebase`, `40256a7`) para a C2a da `main`. Resumo: PGlite pelo `pglite-socket` numa porta livre; a URL do `datasource` lida por tokens; o esquema pelas migrations ou pelo `prisma migrate diff`; uma conexão só (`connection_limit=1` e o `Pool` do `pg` com `max: 1`, senão o pool frio esconde a corrida). Na época, conferido no realworld (os 4 achados da C1) e no prisma-express. A decisão técnica de lá vira a **0019** (o número 0016 já foi usado na `main`). | C2d2 | 1 sessão |
| MVP2 ✅ | **Arnês de teste embutido.** A CLI roda com o `vitest`, o `supertest` e o `msw` dela quando o projeto não tem, sem instalar nada no alvo. É o que faz o passo "instalar e rodar" funcionar. | C2h | 1 sessão |
| MVP3 ✅ | **Aviso de framework não suportado**, para não dar falso verde. | C2f | meia sessão |
| MVP4 ✅ | **Fastify, versão rápida:** rotas, I/O, `createApp` e um exemplo em `examples/` com o teste de aceitação ("topologia com as operações em ordem" e o caos achando a falha). O que não der para provar sai `heuristic`. | F1 | 1–2 dias |
| MVP5 (opcional, fora do critério de pronto; o usuário pede se quiser) | **NestJS, versão rápida**, igual à MVP4: rotas pelos decorators (`@Controller`, `@Post`), o serviço injetado pelo construtor e o `createApp` pelo `NestFactory`. É o mais trabalhoso e o que mais mostra que o motor generaliza. | F4 | 3–4 dias |
| MVP6 ✅ | **Corpos mínimos:** as propriedades lidas no handler (`req.body.user.email`, desestruturação, o DTO do Nest) viram um corpo de exemplo, com valores pelo nome. Sem zod/joi. | C2b | 1 sessão |
| MVP7 | **Empresa mockada numa página do portal:** plano, assinatura e faturas com dados fixos e o selo "demonstração", sem provedor, sem formulário de cartão e sem regra de cobrança. O portal roda local com o `seed:demo`. Screenshot antes de dar por pronto (pedir antes de abrir o Chrome). | B4, figurativa | meia sessão |
| MVP8 ✅ | **Tabela de resultados para o TCC:** o caos nos 3 projetos reais da C1 mais 1 ou 2 em Fastify/NestJS (do `mapa:reais` ou clonados no scratchpad), com achados verdadeiros e falsos, controles e quanto do contrato saiu automático. Vai para `docs/pesquisa/`. | C1 | 1–2 sessões |
| MVP9 | **Roteiro do MVP.** `docs/roteiro-mvp.md`, o passo a passo de "pronto quando" (o `checkout-express` que falha e o `-fixed` que passa, e o mesmo num exemplo Fastify ou NestJS), e o `npm run demo:verificar` cobrindo os exemplos novos. Rodar o roteiro inteiro uma vez (perguntar antes de abrir o VS Code). | demo do TCC | 1 sessão |

Total estimado: 1,5 a 2 semanas. A MVP5 (NestJS) é a parte mais incerta.

**Depois do MVP** (anotado para aprimorar, sem data): autenticação JWT nas requisições (o `--init` gera o token), corpos pelo zod/joi e parâmetros com tipo (C2b/C2c), corrida mais forte com as respostas nos invariantes (C2g), Koa/Hono e Next (F2, F5), os outros ORMs (F6), o caos em C# e Java, e o lançamento mínimo da 0017.

---

### S — Separação produto × empresa

**Por que existe:** hoje o backend da empresa (cerca de 2.700 linhas em `apps/frontend/server/`) e o front estão no mesmo pacote. O mesmo processo carrega as gramáticas do Tree-sitter e a IA para servir `/analyze` e `/chat`. Qualquer mudança de cobrança ou de licença mexeria no pacote que também roda o motor.

- **S1. `apps/api`.** ✅ Mover `apps/frontend/server/` para `apps/api/src/` sem mudar comportamento: mesmas rotas e mesmo banco. Os testes `web.test.ts`, `chaos-runs.test.ts` e `remotes.test.ts` vão junto e continuam passando. Em dev, o Vite faz proxy de `/api` para ela.
  - **Pronto quando:** `npm run check` verde, `npm run web:dev` abre o portal e o login, e o device flow da extensão funciona contra a API nova.
- **S2. `apps/web`.** ✅ Renomear `apps/frontend` para `apps/web`, que fica só com o front e os scripts de build e prerender. Servir o build: a API serve os estáticos em produção (mais simples) ou um CDN (decidir na P2, conforme DP3).
- **S3. Tirar o motor da API.** ✅ Remover `/analyze`, `/chat` e a página "Ferramenta" (`Tool.tsx`, rota `/tool`). Eles rodam o motor no servidor da empresa e duplicam o que a extensão e a CLI fazem. A seção `Demo` da landing continua: é animação, não chama o motor. Se uma demo ao vivo for pedida depois, ela vira um serviço à parte.
  - Feito: o `app.html` **ficou**, porque é a entrada do portal inteiro, não só da ferramenta (o plano antigo errava aqui). O único link para `/tool` era o item "Analisar no navegador" do menu, que saiu sem substituto: ainda não há para onde mandar um "Instalar a extensão" (a página "Downloads" é a B4, e o Marketplace é a G4). O upload do CI passou a ter um contrato próprio na API (`ChaosResults`/`ChaosRunUpload` em `chaosRuns.ts`), em vez de importar do `agent`. Saíram as dependências `core`, `agent` e `extractors` da API, o `SessionStore` (o `sessions.ts` virou `rateLimiter.ts`) e o CSS que só a ferramenta usava.
  - **Falta conferir:** um screenshot do portal sem o item do menu (pedir antes de abrir o Chrome).
- **S4. Teste de fronteira.** ✅ (`apps/api/test/boundary.test.ts`; já pegou o `apps/web` declarando `core`, `agent` e `extractors` sem usar) Um teste que falha se `apps/api` ou `apps/web` passarem a depender de `core`, `extractors`, `agent` ou `viewer`, seja por `package.json` ou por import.
- **S5. Remover `legacyRoutes.ts`.** ✅ Ele redireciona páginas `.html` antigas, e a extensão já usa `/device-confirm` (`AuthService.ts:184`). Nenhuma versão com os endereços antigos foi publicada.
- **S6. Documentação.** ✅ Atualizar os READMEs, o `.vscode/launch.json`, os scripts do `package.json` da raiz e o `.env.example` com os nomes novos.
- **S7. DDD por domínio na `apps/api`.** Reorganizar `src/` em `domains/<contexto>/{domain,application,infra,http}` e `shared/`. Os contextos são `identity` (contas, senhas, sessões web, OAuth, device flow e tokens da extensão), `companies` (empresas e membros), `projects` (projetos, repositórios, remotes e tokens de CI) e `chaos-runs` (execuções publicadas pelo CI). Depois vêm `licensing` (A) e `billing` (B).
  - O domínio não importa `node:sqlite`, `http` nem `shared/`. Os casos de uso recebem os repositórios por interface. O SQL atual vira `infra/Sqlite*Repository`, que a P1 troca por Postgres.
  - O teste de fronteira (S4) ganha a regra das camadas: `domain` não importa `infra`, `http` nem driver de banco; um domínio só usa outro pela `application` dele. A checagem lê os imports pela AST do TS.
  - Sem mudar comportamento: as rotas e os testes de HTTP (`web.test.ts`, `chaos-runs.test.ts`) continuam passando. Uma fatia (e um commit) por contexto.
  - Fatias: **S7a ✅ `shared/`** (`db/sqlite.ts`, `http/{http,static,rateLimiter}.ts`, `crypto/{tokens,passwords}.ts`; o `app.ts` só monta; as regras das camadas no `boundary.test.ts`) → **S7b ✅ `chaos-runs`** (domain: upload, execução e token de CI; application: `ChaosRunService` com portas; infra: `SqliteChaosRunRepository`, `SqliteCiTokenRepository`; http: as 6 rotas; teste do domínio com repositórios em memória; as checagens de acesso foram para `auth/guards.ts` até a S7c/S7e) → **S7c ✅ `projects`** (domain: projeto, visibilidade `canSee`, remote; application: `ProjectService`; infra: `SqliteProjectRepository`; http: CRUD, repositórios, membros, `workspace` e o `repos/check` da extensão; a montagem de todos os domínios passou para `src/composition.ts`, e as rotas de `chaos-runs` recebem o `ProjectService` pela application) → **S7d ✅ `companies`** (domain: empresa, papel, permissões com padrões, "pelo menos um dono", validação de convite; application: `CompanyService`; infra: `SqliteCompanyRepository`; http: equipe e admin de empresas; as funções de usuário foram para `auth/users.ts`) → **S7e ✅ `identity`** (domain: usuário, credenciais e seus prazos, a cerimônia da extensão, OAuth; application: `IdentityService` com portas, inclusive `OAuthClient`; infra: os `Sqlite*Repository` e o `HttpOAuthClient`; http: as rotas de login, conta, extensão e admin de usuários, e o `Access` — o contrato em `shared/http/access.ts` — que o `composition.ts` entrega às rotas de todos os domínios). A `auth/` sumiu; `bootstrap` e `seedDemo` foram para `src/scripts/`.

---

### C — Motor: caos utilizável (continua da etapa C antiga)

**Por que existe:** o caos é o diferencial (nenhum concorrente levantado gera caos pela topologia), mas só roda em Express + pg/Prisma + fetch/axios, e com um contrato escrito à mão. A M (ver `docs/historico/PLANO-CHAOS.md`) já pôs o Mongoose e os padrões CommonJS no mapa e na topologia, mas o DB_Chaos só injeta falha no `pg`.

- **C1 ✅ Caos em 3 projetos Express reais** (2026-10-24): `pg-crud` (JS, `pg`), `realworld` (TS, Prisma 4) e `prisma-express` (TS, Prisma 7). Para clonar de novo: `npm run mapa:reais -- --dir <scratchpad> --so realworld,prisma-express,pg-crud`. A tabela, como cada contrato rodou e a lista ordenada para a C2 estão em [`docs/pesquisa/caos-projetos-reais.md`](docs/pesquisa/caos-projetos-reais.md).
  - Os controles passaram nos três: 5 achados verdadeiros, nenhum falso, e 3 "aguentou" que não provam nada (requisições iguais; invariante sem as respostas). Nenhum `--init` rodou sem edição.
  - Corrigido no motor: o `createApp` do contrato que remonta os roteadores duplicava as rotas e as hipóteses (`topology/routes.ts` ignora as chamadas do `shieldepy.chaos.config.ts`, que continua no grafo; teste em `code-graph/walk.test.ts`).
  - Achado principal: o PGlite em memória esconde corridas (não devolve a vez ao event loop). O banco falso precisa de um `setImmediate` por consulta.
- **C2. Contrato quase automático.** Meta: num projeto Express suportado, o `--init` gera um contrato que roda sem edição ou com no máximo 1 pendência. **Ordem, pela C1:** C2d1 ✅ → C2a ✅ → C2d2 → autenticação → C2b/C2c → testes de corrida mais fortes (C2g) → arnês de teste no projeto (C2h). O detalhe de cada uma está na seção 5 do relatório da C1.
  - **C2a ✅ `createApp` sem editar o projeto.** Na C1, nenhum dos três exportava o app; nos três, o arquivo que monta o app chama `listen()` no topo.
    - **C2a1 ✅ (2026-10-30): os passos 1 a 4 abaixo.** Como ficou (o detalhe está em `docs/como-funciona.md`, "O `createApp` gerado"):
      - o extrator marca a chamada que só roda num ramo (`CallSite.conditional`: `if`, `switch`, ternário, `&&`/`||`/`??`, `catch`) e os nomes que uma função devolve (`returnsNames`, do `return app`); o `CodeGraph.valueCallOf` diz de que chamada sai um valor do topo;
      - o `RouteScan.apps` (fora da topologia, para não mudar o `topologyHash`) tem cada `express()` raiz: o arquivo, a linha, se é CommonJS, o export (o app ou a fábrica, só com `return app` provado) e os `listen`, inclusive os do topo do arquivo em outro receptor (`createApp().listen()`, `http.createServer(app).listen()`);
      - `packages/core/src/chaos-app.ts`: `chaosAppPlan` (escolhe o app com mais rotas sensíveis; os outros saem num comentário), `chaosAppContract` e `chaosSetupScaffold`, que monta o `chaos/setup.ts` com a troca do `express` e a do `pg` (o `chaosDbScaffold` não gera mais o setup). O `chaosConfigScaffold` passou a receber `{ db, app }`;
      - o caso (b) em CommonJS (o que não tinha sido testado) funciona: o `require.cache` do `express` trocado antes de o app carregar. O `chaos-app.test.ts` roda o setup gerado num Vitest à parte (no `examples/checkout-express/.shieldepy/`, o único lugar com `express` e `supertest`), em ESM e em CommonJS, e confere que a porta do `listen()` continua livre. O controle sem a anulação do `listen()` dá `EADDRINUSE`;
      - achado no caminho: o contrato importa o `chaosApp` do `chaos/setup.ts`, então o `vi.mock` e a troca no cache rodam mesmo sem o `setupFiles`. O registro dos apps fica no `globalThis` para valer com mais de uma instância do arquivo;
      - fora do alcance, com pendência no contrato: o `listen` fora do app no arquivo guardado. O `--init` não sabe trocar o `http.createServer`.
    - **C2a2 ✅ (2026-10-30): o passo 5, a aceitação nos 3 projetos da C1** (seção 6 de [`docs/pesquisa/caos-projetos-reais.md`](docs/pesquisa/caos-projetos-reais.md)). O `--init` saiu sem a pendência do `createApp` nos três, todos no modo "guardar". No pg-crud, o `chaos --offline` deu o mesmo achado da C1 (`POST /categories` Crítico) sem nenhuma linha de `createApp`: à mão, só o esquema, os corpos, um registro e a invariante. Sem a invariante, dá "aguentou" (seção 4 do relatório). No realworld e no prisma-express, uma fumaça com o contrato e o setup gerados: 404 numa rota inexistente e a porta do `listen()` livre. Atrás do proxy desta máquina, o `prisma generate` precisa de `NODE_OPTIONS=--use-system-ca`.

    Detalhe original, para começar num chat novo:
    1. **O motor diz onde o app nasce.** Hoje o `findExpressRoutes` (`packages/core/src/topology/routes.ts`) só devolve `routes` e `skipped`. Ele passa a devolver também os apps: o arquivo e a posição do `express()` raiz (o valor que recebe as montagens e não é montado em ninguém), se o valor é exportado (`export default app`, `module.exports = app`, `export { app }`, ou uma função exportada que o devolve), e as chamadas `listen` nele, com arquivo e se estão no topo do módulo. Ler pelo grafo (`callSitesIn`, `valueCalls`, `receiverOrigin`), nunca por regex.
    2. **Três casos no `--init`** (`chaosConfigScaffold` em `packages/core/src/chaos-config.ts`, e a CLI em `apps/cli/src/chaos.ts`):
       - **(a) exportado e sem `listen` no mesmo arquivo:** `import app from './src/app'` (ou `import { createApp }` e chamar). Sem pendência. É o `checkout-express`.
       - **(b) o arquivo do app chama `listen` no topo** (os três da C1): o `chaos/setup.ts` gerado troca o `express` por um que guarda o app criado num global e faz o `listen()` não abrir porta. O contrato importa o arquivo de entrada só pelo efeito (`import './src/index'`) e o `createApp` devolve o global. Isso **rodou no prisma-express** (ESM/TS) com `vi.mock('express', ...)`: o código está na seção 3.3 do relatório da C1. **Em CommonJS** (pg-crud: `const app = express()` com `require`), o `vi.mock` não alcança o `require` nativo. É preciso trocar o `exports` do `express` no cache do `require` (`require.cache[require.resolve('express')].exports = embrulhado`) antes de o app carregar, e importar a entrada com `createRequire`. **Isso ainda não foi testado:** conferir primeiro no pg-crud.
       - **(c) não deu para achar:** a pendência de hoje (`TODO(shieldepy): preencha createApp`), com o arquivo e a linha do `express()` no comentário quando houver.
    3. **Cuidados:**
       - o efeito de importar a entrada (o `dotenv`, o `PrismaClient` no topo e as conexões abertas no import) roda nos testes. O banco já é trocado pelo `setup.ts` antes disso;
       - mais de um app no projeto (monorepo, `examples/`): escolher o que tem as rotas sensíveis e avisar se houver mais de um;
       - o `chaos/setup.ts` hoje é gerado só com o `pg` (C2d1). Com a C2a, ele também sai sem banco, só com o `express`, e as duas partes precisam conviver no mesmo arquivo.
    4. **Testes:**
       - no core, um por caso: exportado, `listen` no topo em ESM, em CommonJS, `listen` dentro de `if (require.main === module)` (conta como "não no topo"), e app criado dentro de uma função exportada;
       - na CLI, um `--init` por caso (como os da C2d1 em `apps/cli/test/cli.test.ts`);
       - um teste que rode de verdade o `setup.ts` gerado do caso (b), no estilo do `packages/core/test/chaos-db.test.ts` (arquivos numa pasta `.shieldepy/`, ignorada pelo git, dentro do repositório, para achar os pacotes da raiz).
    5. **Aceitação nos 3 projetos da C1** (num chat novo, clonar de novo: `npm run mapa:reais -- --dir <scratchpad>/reais --so realworld,prisma-express,pg-crud`; instalar com `npm install --ignore-scripts` e os pacotes de teste que o `--init` listar; no realworld, `npm install --ignore-scripts --omit=dev` e depois `npm install --ignore-scripts --no-save prisma@4.16.2 vitest@2.1.9 supertest@7 msw@2 @electric-sql/pglite-socket@0.2.11`, e no realworld e no prisma-express, rodar o `prisma generate`):
       - o `--init` sai sem a pendência do `createApp` nos três;
       - no pg-crud, com o banco da C2d1, o `chaos` dá o mesmo achado da C1 (`POST /categories`) sem nenhuma linha de `createApp` escrita à mão;
       - o banco do realworld e do prisma-express ainda é à mão (a C2d2 é a do Prisma), como na seção 3 do relatório.
  - **C2b. Corpos válidos:** zod ou joi → class-validator → tipo TS do `req.body` → propriedades lidas no handler.
  - **C2c. Parâmetros de rota com tipo:** por exemplo, uuid.
  - **C2d. `reset` e banco de teste.**
    - **C2d1 ✅ `pg`** (2026-10-24). Com o `pg` no mapa, o `--init` gera `chaos/db.ts` e `chaos/setup.ts` (gerador em `packages/core/src/chaos-db.ts`):
      - o `db.ts` tem PGlite com os `.sql` do projeto (os de uma pasta `migrations`, senão todos; sem nenhum, um `chaos/schema.sql` com as tabelas do mapa e uma pendência), um `Pool`/`Client` com a cara do `pg` e a pausa `setImmediate` por consulta, e um `resetDb()` que esvazia tudo;
      - o `setup.ts` faz o `vi.mock` e a troca no cache do `require`;
      - o contrato sai com `setupFiles` e `reset` preenchidos, e o `--init` diz o `npm install -D` que falta (o começo da C2h).
      - Conferido no pg-crud da C1: com o banco gerado, preenchendo só o esquema, o `createApp`, os corpos e um registro de exemplo, saiu o mesmo achado da C1. O `chaos-db.test.ts` dá `[201, 409]` sem a pausa e `[201, 201]` com ela.
    - **C2d2 — Prisma** (pendente): adapter do PGlite para o Prisma 6+ (ou o `pglite-socket` com `DATABASE_URL`), o esquema por `prisma migrate diff --from-empty` ou pelas migrations, e o `reset` por `TRUNCATE`.
  - **C2e. `apis` com resposta saudável:** SDKs conhecidos; senão `{}` com pendência.
  - **C2f. Aviso de "framework não suportado":** quando a topologia dá 0 rotas e há Fastify, Nest, Koa, Hono, Next ou `node:http` nas dependências. Evita o falso verde silencioso, e **sai antes da G**.
  - **C2g. Testes de corrida mais fortes** (nova, da C1): requisições variadas (duas entidades indo para o mesmo valor), as respostas no contexto dos invariantes, e Alto em vez de Crítico quando só o `noUnhandledError` falha.
  - **C2h. Arnês de teste no projeto** (nova, da C1): o `chaos` exige `vitest`, `supertest` e `msw` no alvo; o `--init` diz o comando de instalação, ou a CLI usa os dela.
  - A C2b/C2c ganham, da C1, a autenticação (JWT): rota com `express-jwt` não é "pronta".
  - Onde mexer: `packages/core/src/chaos-config.ts`, `apps/cli/src/chaos.ts`, `packages/core/src/topology/` e `packages/agent/src/chaos/templates.ts`.
- **C4. Caos no CI de verdade.** O `shieldepy-chaos.yml` nunca rodou no Actions. Preparar a branch de teste que mexe numa rota sensível do `checkout-express`, e o usuário abre o PR. Conferir o comentário com o relatório, o exit 1 e o escopo `--base`.
  - **C4b.** O template ganha o `report --fail-on critico`, e o `cycles` passa a sair com código diferente de 0 quando usado com uma flag de portão.
  - Depende de DP2: o template aponta para o repositório do ShielDepy.
- **F. Rotas e I/O do resto de JS/TS (3 a 5 semanas, em fatias).** Cada fatia leva junto o `createApp` e os corpos daquele framework (a C2), e tem um exemplo em `examples/` com o teste de aceitação "topologia com as operações em ordem".

  | Fatia | O que | Estimativa |
  |---|---|---|
  | F1 | Fastify | 1–2 dias |
  | F2 | Koa + `@koa/router`, Hono | 1–2 dias |
  | F3 | `node:http` puro | 2–3 dias |
  | F4 | NestJS | 3–4 dias |
  | F5 | Next.js (`route.ts`, `pages/api`) | 2–3 dias |
  | F6 | TypeORM, Sequelize, Drizzle, Knex, mysql2, SQLite, driver do MongoDB (o Mongoose já está no mapa desde a M3; falta o caos nele) | 1–2 dias cada |
  | F7 | got, undici, ky, node-fetch, SDKs comuns | 0,5–1 dia cada |

  **Ordem:** pelas stacks dos times que testarem o produto (ver G). Sem esse dado, F1 → F4 → F6 (Mongoose, Sequelize) → F5 → resto. A F3 deixou de ser a primeira: ela provaria o caos no portal, e na S3 o portal passa a não rodar o motor.

---

### D — Dados para treinar a IA de erros de produção (nova, 2026-10-30)

**Por que existe:** outra equipe vai treinar um modelo aberto (Llama-3.2-1B-Instruct, com DPO) para ser especialista em erro de produção, com os dados que o ShielDepy gera. A proposta dela previa um projeto à parte com o `tree-sitter` nativo, Neon com pgvector, LangSmith e o Sonnet como validador. O que vale e o que muda está na [0016](docs/decisoes/0016-dados-para-treino.md). Em resumo: **o motor gera os dados pela CLI, o rótulo vem do Vitest (controle × caos), só entra código público ou nosso, e o banco do treino é o da outra equipe, não a `apps/api`.**

**O que já existe e serve de matéria-prima:** o mapa e a topologia (rotas, operações em ordem com `arquivo:linha`, `proven`/`heuristic`, tags), as hipóteses do catálogo, as specs validadas, o `.spec.ts` gerado, o resultado de cada teste com severidade e invariante (`.shieldepy/chaos-results.json`, `packages/agent/src/chaos/results.ts`) e o custo. Falta juntar isso com o código da rota num registro por hipótese, e gerar volume.

**Onde mexer:** `packages/agent/src/chaos/` (o registro, como função pura), `apps/cli/src/chaos.ts` (a flag) e um script na raiz. **Não mexe** na `apps/api` nem na `apps/web`.

- **D1 ✅ (2026-10-31). O registro (JSONL v1).** `packages/agent/src/chaos/dataset.ts`, função pura com teste. Um registro por hipótese testada:
  - `id` estável (hash do projeto, do commit e da hipótese) e `schemaVersion: 1`;
  - `source`: projeto, URL do repositório, commit, licença (do `package.json` ou do `LICENSE`) e variante (`original`, `fixed` ou `mutante:<operador>`);
  - `route`: método e path, a cadeia de handlers, as operações em ordem (tipo, alvo, `arquivo:linha`, `proven`/`heuristic`) e as tags;
  - `code`: o corpo de cada função da cadeia, recortado pelos símbolos do grafo (faixa de nós do Tree-sitter, nunca regex), com `arquivo:linha`;
  - `hypothesis`: a falha do catálogo, o alvo, quem escreveu (`offline`, ou o provedor e o modelo), a spec validada e o que a validação descartou (rota, falha ou alvo inventados pela IA);
  - `result`: o status do controle e do caos, o desfecho (`achado`, `aguentou`, `inválido`), a invariante violada, a severidade e a duração;
  - `test`: o texto do `.spec.ts` gerado; e o `topologyHash`.
  - **Pronto quando:** o teste confere um registro do `checkout-express` campo a campo, e a mesma entrada dá o mesmo JSON (ordem estável).
  - **Feito:** `buildDatasetRecords`, `datasetJsonl` e `routeCode` (o corpo de cada função da cadeia pela faixa do símbolo no grafo), em `packages/agent/test/chaos/dataset.test.ts`. Escolhas: só entra hipótese com resultado (sem resultado não há rótulo); o id é o hash do projeto, repositório, pasta, commit, variante, motor e hipótese (o `fixed` e o mutante não colidem com o original, e o `hypothesis.id` é o que junta os pares); o `result` traz `control` e `chaos` separados (`passed`/`failed`/`not-run`); o código vai com quebra de linha `\n`, sem o `\r` do Windows.
- **D2 ✅ (2026-10-31). `shieldepy chaos <pasta> --dataset <arq.jsonl>`.** Acrescenta os registros da execução ao arquivo, sem rede no modo `--offline`. Inválido também vai (com o motivo), para a outra equipe filtrar.
  - **Pronto quando:** no `checkout-express` saem os 6 achados com o controle passando; no `checkout-express-fixed`, os mesmos ids de hipótese com "aguentou". Teste na `apps/cli/test/cli.test.ts`.
  - **Feito:** `apps/cli/src/dataset.ts` (a fonte pelo git local, o remote sem credencial, a licença do `package.json` ou do `LICENSE` da pasta ou da raiz do repositório, a variante pelo sufixo `-fixed`); no `chaos.ts`, só a flag e a chamada. Com o Vitest de verdade: 6 achados no original; no `-fixed`, 4 hipóteses aguentam, a `partial_failure` em `stock` sai inválida (a falha não dispara, como na E4) e a de `timeout` nem existe (o corrigido tem timeout). Os exemplos não têm licença declarada (depende da DP2): o campo sai vazio.
- **D3. O corpus.** `npm run dataset:gerar -- --dir <scratchpad>`: roda o `chaos --dataset` nos `examples/` e nos projetos do `mapa:reais` (clonados no scratchpad, fixados por commit, `npm install --ignore-scripts`). Primeiro só offline (grátis). Com a IA escrevendo as hipóteses e as specs, só depois da DP6 e com autorização (estimar antes com `npm run estimate:chaos`).
  - **Volume, sem enfeitar:** hoje são 2 exemplos e os 3 projetos da C1, que deram 5 achados verdadeiros. Isso é dezenas de registros, não milhares. O alcance é o da C (Express + pg/Prisma + fetch/axios); a F aumenta.
  - **Offline ✅ (2026-10-31):** `scripts/dataset-generate.ts` roda os exemplos e os reais que têm contrato guardado em `scripts/dataset/contratos/<id>/` (o contrato vai por cima do clone; o arnês entra com `--no-save`), uma parte por projeto em `<dir>/partes/`, e junta tudo por id (`mergeDatasetJsonl`). A lista e o clone dos reais saíram para `scripts/real-projects.ts`, que o `mapa:reais` também usa. Resultado: **13 registros**: checkout-express 6 achados; o `-fixed` 4 aguentou e 1 inválido; pg-crud (ISC) 1 achado (`POST /categories`) e 1 aguentou, como na C1. ~13 KB por registro.
  - **Falta:** o realworld e o prisma-express precisam do banco de teste do Prisma (MVP1): o contrato deles entra em `scripts/dataset/contratos/` depois do merge do MVP (a sessão do MVP tem os dois rodando). O pg-crud veio do contrato da C2a. A versão com IA segue parada (DP6 e autorização).
- **D4 ✅ (2026-10-31). Pares por mutação.** É o que dá volume ao DPO. A partir de código que aguenta (o `-fixed` e as rotas reais que deram "aguentou" com controle verde), aplicar mutações pela AST numa cópia no scratchpad, uma por mutante:
  - tirar o `timeout`/`signal` de um `fetch` ou `axios`;
  - tirar o `BEGIN`/`COMMIT` ou o `FOR UPDATE`;
  - inverter a ordem "reserva → cobrança";
  - tirar o estorno do `catch` depois da API.

  Um mutante só vira par se o original aguentou **e** o mutante deu achado no mesmo teste, com o controle passando nos dois. A troca é por faixa de nós do Tree-sitter, sem regex.
  - **Feito:** `findMutations`/`applyEdits` em `packages/agent/src/chaos/mutations.ts` (operadores `sem-timeout`, `sem-transacao`, `cobra-antes-de-reservar`, `sem-estorno`; os passos são reconhecidos pelo nome do método no nó da chamada) e `npm run dataset:mutantes -- --dir <a pasta do dataset:gerar>`: cada mutante é uma cópia no scratchpad com uma junção para o `node_modules` do original; o registro sai com a fonte do original, a variante `mutante:<operador>@<arquivo>:<linha>` e `source.mutation`. No `-fixed`, 4 mutantes: sem o `signal` da cobrança → achado de `timeout`; cobrar antes de reservar → `race` e `partial` em `stock`; sem o estorno → `partial` em `orders`; sem o `signal` do estorno → aguentou (nenhum teste exercita o estorno lento). No pg-crud, nenhum sítio. **Corpus: 35 registros e 19 pares** (6 de correção, 13 de diagnóstico).
  - **Escolhas:** o `chosen` de uma correção nunca é um mutante (ele aguentou aquela falha, mas tem o defeito que a mutação pôs); por isso o mutante sem timeout não dá par de correção: o `-fixed` não tem a hipótese de timeout para servir de `chosen`.
  - **Falta:** tirar só o `FOR UPDATE` de dentro do SQL precisa das posições dos tokens no lexer do core (`packages/core/src/sql/lexer.ts`); o `sem-transacao` hoje tira as chamadas `query('BEGIN'|'COMMIT'|'ROLLBACK')` de uma função, e não há esse caso nos exemplos (testado num trecho sintético).
- **D5 ✅ (2026-10-31). Pares para o DPO** (`npm run dataset:pares`), no formato a combinar com a outra equipe: `{ prompt, chosen, rejected, provenance }`.
  - **Feito:** `dpoPairs` em `packages/agent/src/chaos/dataset-pairs.ts` e `scripts/dataset-pairs.ts` (`--sem-fracos` tira os de diagnóstico). Só entra registro com o controle verde. A família junta o exemplo, o `-fixed` e os mutantes (repositório + projeto sem o `-fixed`). O prompt traz a rota, as operações em ordem e o código da cadeia, em pt-BR. No corpus de hoje: 4 pares de correção (race, 5xx, malformed e partial em `orders`, do checkout-express × `-fixed`) e nenhum de diagnóstico (no exemplo tudo deu achado; no pg-crud o achado e o "aguentou" são de rotas diferentes). **Formato aprovado pela equipe de treino em 2026-11-02** ([0021](docs/decisoes/0021-pares-dpo-no-neon.md)): os templates de instrução no `prompt`, `kind` como `correcao`/`diagnostico`, e os 19 pares gravados em `shieldepy_dpo_pairs` no Neon.
  - **Correção:** o prompt é o código vulnerável com o achado; o `chosen` é a versão que aguentou; o `rejected` é a que ainda dá achado.
  - **Diagnóstico:** o prompt é o código da rota; o `chosen` é a falha que deu achado, com a invariante; o `rejected` é uma falha que aguentou na mesma rota. Marcar como fraco: "aguentou" não prova que a rota é segura (C1, seção 4).
- **D6 ✅ (2026-10-31). Entrega e documentação.** `docs/dataset.md`: o esquema, o que cada campo quer dizer, os limites (o alcance, o volume, "aguentou" não é "seguro") e como rastrear a geração no LangSmith (as variáveis `LANGCHAIN_*` só na máquina que gera; conferir se o `@langchain/core` já traz o `langsmith` ou se a CLI precisa declarar). A outra equipe importa o JSONL no banco dela.
  - **Feito:** o guia tem os comandos, cada campo, como usar os rótulos, os mutantes, os pares, o que há hoje e os limites. O `@langchain/core` já traz o `langsmith` (não precisa declarar na CLI); o traço liga com `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` (o `LANGCHAIN_*` também vale), só na máquina que gera. Ele mostra os nós do grafo com a superfície (sem código), não as chamadas à IA como runs de LLM, porque elas passam pelo `LLMProvider` do ShielDepy. O mapa do código em `docs/como-funciona.md` ganhou a linha do dataset.
- **D7 ✅ (2026-10-31). O envio automático ao Neon** ([0020](docs/decisoes/0020-dataset-direto-no-neon.md), escolha do usuário: o Neon da equipe como destino, toda execução do `chaos` como gatilho). Com a variável `SHIELDEPY_DATASET_DATABASE_URL`, o fim do `runChaosCommand` (CLI e plugin) grava os registros na tabela `shieldepy_dataset` por upsert no `id`; sem ela, nada sai. Falha no envio só avisa e o log não mostra a senha. O `dataset:mutantes` envia os registros já corrigidos (o filho roda sem a variável). Teste em `apps/cli/test/dataset-db.test.ts`, contra o PGlite (Postgres de verdade, no processo): a tabela, o upsert, os lotes de 50 e o banco fora do ar. O `chaos.js` da extensão foi de 1,9 para 2,08 MB com o `pg`.
  - **Conferido de verdade (2026-10-31):** com a URL que a equipe passou, o `chaos` nos dois exemplos gravou 11 registros no Neon dela, e o corpus inteiro foi enviado depois. Isso mostrou um defeito: o `id` dependia do commit do nosso repositório, e os exemplos entraram duas vezes. Agora o `id` sai do conteúdo (código, spec, teste). O corpus foi reenviado com o `id` novo (35 linhas, criadas em 2026-10-31 18:46:57 UTC). As 46 linhas antigas ficaram, a pedido do usuário (a tabela tem 81), e a equipe filtra pela data.
  - **Falta:** a equipe trocar as chaves que vieram no chat (Neon, LangSmith, Hugging Face) e criar um usuário que só escreve nas tabelas. As 46 linhas antigas de `shieldepy_dataset` ainda estavam lá em 2026-11-02, apesar de a equipe dizer que as apagou (os pares não são afetados).
- **Ordem:** D1 → D2 → D6 (o mínimo para a outra equipe começar) → D4 → D5 → D7 → D3 com IA (DP6).

---

### LM — Lançamento mínimo: só o necessário da empresa para distribuir o produto

**Por que existe:** a meta é o site da empresa no ar e a extensão instalável por qualquer pessoa, com o mínimo de full stack ([0017](docs/decisoes/0017-lancamento-minimo.md)). A extensão já funciona sem conta (o motor é local), então dá para lançar antes de a API estar no ar. Cada item abaixo é uma tarefa da W, da G ou da P, só no tamanho necessário.

- **Degrau 1: lançar (sem servidor).** Depende de DP4 (domínio e e-mail) e de DP2 (repositório privado ou público; o Marketplace aceita privado).
  1. **W1–W3:** a landing honesta: as 8 promessas corrigidas, o que é "em breve" marcado, o plano Local (grátis) visível e "Entrar na lista de espera" ou "Falar com o time", com o contato real, no lugar de "Assinar".
  2. **Site estático:** só o build da landing (`apps/web`), sem a API, numa hospedagem estática grátis (Cloudflare Pages, Vercel ou Netlify), no domínio da empresa. Os links do portal saem até o degrau 2.
  3. **C2f:** o aviso de "framework não suportado" (evita o falso verde com Fastify, Nest e afins).
  4. **A extensão pronta para estranhos:** **G1** (versão e changelog); o login e o portal desligados ou escondidos enquanto não há API (hoje o `shieldepy.webBaseUrl` aponta para localhost); README e página do Marketplace honestos; o E2E rodando contra o `.vsix` antes de publicar (perguntar antes de rodar).
  5. **Termos de uso e política de privacidade** (o pedaço da P5 que o Marketplace pede): o que a extensão envia (nada sem login) e o que vai para a IA (só com a chave do usuário, [0006](docs/decisoes/0006-ia-byok.md)).
  6. **G4:** a publicação no Marketplace do VS Code (publisher `shieldepy`, token do Azure DevOps) e no Open VSX (Cursor, VSCodium). Os tokens e a publicação são do usuário.
- **Degrau 2: portal e API no ar (login, equipe, histórico do caos).** Depende de DP3 (sugestão: PaaS como Railway, Render ou Fly, com Postgres gerenciado como o Neon).
  1. **P2:** o Dockerfile da API (que já serve o site, `npm run web`), o Postgres gerenciado com o `db:migrate` no deploy, TLS, as variáveis de ambiente e o OAuth do Google e do GitHub com as URLs de produção. A extensão passa a apontar para o domínio.
  2. **P3, o mínimo:** cookies `Secure`/`SameSite`, rate limit no login e no device flow, CSP, segredos fora do repositório e um `/security-review` antes de abrir o acesso.
  3. **P4, o básico:** backup diário do Postgres (com uma restauração testada uma vez) e logs.
  4. **Cadastro:** os primeiros 5 a 10 times entram pelo admin (`npm run bootstrap` e o painel de empresas). O cadastro self-service fica para a B2.
  5. Conferir num VS Code real o device flow da extensão contra a API de produção (perguntar antes).
- **Fica para depois do lançamento:** a CLI no npm (G2), o `.vsix` nas Releases (G3), o workflow de release automático (G5), a licença (A), a cobrança (B) e o resto da P (status, alertas, exportação e exclusão de conta).

---

### W — Landing honesta

**Por que existe:** o relatório de preços (seção 7.4) achou 8 promessas que o código não cumpre, duas delas de segurança. O release vai mandar gente para a landing.

- **W1.** Aplicar a tabela 7.4 de [`docs/pesquisa/precos-concorrencia.md`](docs/pesquisa/precos-concorrencia.md):
  - "só funciona no repo do seu projeto" e "suspender trava em até 1 minuto" reescritos;
  - portão no CI, painel por repositório, CLI e implantação no seu ambiente marcados como **em breve** até existirem;
  - "seis linguagens" vira algo como "mapa, rotas e I/O em TS/JS, C# e Java; caos em TS/JS; colisões também em Python e PL/pgSQL". Conferir no código no dia, porque a L e a J mudaram o alcance.
- **W2.** Seção de **caos** com o alcance explícito, que hoje está fora da landing.
- **W3.** Plano **Local (grátis)** visível. Os botões de "Assinar" viram "Entrar na lista de espera" ou "Falar com o time" até a B3, com um contato real (DP4).

---

### G — Distribuição do produto

**Por que existe:** hoje a extensão é um `.vsix` local e a CLI é `"private": true`. Ninguém de fora consegue instalar.

- **G1. Versão e changelog.** Semver único para extensão e CLI, CHANGELOG por pacote e um script que gera a versão e a tag.
- **G2. CLI no npm.** Tirar o `private`, publicar `@shieldepy/cli` (ou `shieldepy`) com `bin`, e empacotar `core`, `extractors`, `agent` e `viewer`: publicados juntos ou embutidos num bundle, decidir pelo tamanho. Teste: `npx shieldepy chaos examples/checkout-express --offline` numa pasta limpa.
- **G3. `.vsix` nas GitHub Releases.** O E2E roda contra a extensão instalada do `.vsix` antes do release (o procedimento está no `apps/vscode/README.md`).
- **G4. Marketplace e Open VSX.** Publisher `shieldepy` no Marketplace (token do Azure DevOps) e namespace no Open VSX (Cursor, VSCodium e afins).
- **G5. Workflow de release.** Uma tag `v*` dispara: `npm run check`, o E2E, o pacote, o npm, as Releases e os marketplaces. Os segredos ficam no GitHub, e o usuário configura.
- **Validação junto da G:** de 5 a 10 times usando de graça (design partners). Eles definem a ordem da F e validam o preço antes da B.

---

### A — Licença: direito de uso por empresa

**Por que existe:** é a ponte entre "pagou" e "o recurso pago liga". Toda tarefa daqui usa TDD.

- **A1. Modelo de direito de uso (`packages/license`).** Tipos e funções puras: `Plan`, `Entitlement` (empresa, plano, assentos, válido até, estado) e `can(entitlement, recurso)`, que diz se o recurso está liberado. Os recursos são uma lista fechada: `portal`, `team`, `chaosHistory`, `ciPublish`, `aiPolicy`… Os testes vêm primeiro, cobrindo cada plano × recurso e o estado de inadimplente ou cancelado.
- **A2. A API aplica o direito de uso.** As rotas de recursos pagos (publicar execução do CI, convidar pessoa, histórico) checam `can()` no servidor. `GET /api/entitlement` devolve o direito de uso da empresa do usuário ou do token. A extensão mostra o plano nas configurações. **O motor local não é afetado** (R1).
- **A3. Licença assinada offline (só se for preciso).** JWT Ed25519 com validade de 7 dias e carência de 14, verificado com a chave pública embutida no produto. Entra **só** se algum recurso pago rodar local, por exemplo IA hospedada com cota ou relatório avançado offline. Até lá, não fazer: com tudo pago no servidor, é complexidade sem ganho.
- **A4. Assentos.** Conta "contribuidor ativo em 90 dias": quem usou a extensão logada ou publicou pelo CI. Ao passar do limite, a API avisa primeiro (aviso no portal e e-mail) e só depois bloqueia o recurso pago. Nunca bloqueia o motor.

---

### B — Monetização

**Por que existe:** não há cobrança, plano nem cadastro sem admin (`routes.ts:454`). Toda tarefa daqui usa TDD.

- **B1. Plano e assinatura no banco.** Tabelas `plans` e `subscriptions`. Báquina de estados `trial → ativa → inadimplente → suspensa → cancelada`, como função pura com testes primeiro (transições válidas, inválidas recusadas, datas). Depende de DP5.
- **B2. Cadastro self-service e trial.** Cadastro cria a empresa e o primeiro dono, com e-mail verificado e trial de 14 dias. Isso substitui a criação só pelo admin, que continua existindo para suporte.
- **B3. Cobrança (depende de DP1).** Checkout hospedado pelo provedor, sem dado de cartão passando por nós. O webhook é a única fonte de verdade sobre o estado da assinatura:
  - assinatura do webhook verificada;
  - idempotência por id do evento;
  - evento fora de ordem não volta o estado.

  Testes com payloads reais gravados. Mensal e anual com 20% de desconto. NFS-e automática (Asaas) ou emissor à parte (Stripe).
- **B4. Telas do portal.** "Assinar" com a escolha do plano e o checkout, "Meu plano" (estado, próxima cobrança, assentos usados, trocar e cancelar), "Faturas" e "Downloads" (links para Marketplace, Open VSX, npm e Releases, com o passo a passo de login).
- **B5. Caminho do dinheiro ponta a ponta:** o teste descrito em "Como testar".

---

### P — Produção

**Por que existe:** o portal só roda com `npm run web` em localhost.

- **P1. Postgres e migrations com Drizzle** (decisão [0015](docs/decisoes/0015-drizzle.md), escolhida pelo usuário em 2026-10-23; Alembic e Prisma descartados). Trocar o `node:sqlite` por Postgres. Com `DATABASE_URL`, um Postgres de verdade (`pg`); sem ela, o PGlite em `apps/api/data/pglite`, para o dev e os testes não instalarem nada. A API aplica as migrations pendentes ao subir.
  - **P1a ✅ Esquema e migrations.**
    - Dependências na `apps/api`: `drizzle-orm` 0.45.4, `pg` 8.23.1, `@electric-sql/pglite` 0.5.11, e no dev `drizzle-kit` 0.31.11 e `@types/pg`.
    - `src/shared/db/schema.ts` tem as 15 tabelas, iguais às do SQLite: datas em ms como `bigint`, `company_permissions.value` como `boolean` e `chaos_runs.payload` como `jsonb`.
    - `src/shared/db/postgres.ts` (`openDatabase`): escolhe PGlite ou `pg` e aplica as migrations.
    - `drizzle.config.ts`, o script `db:generate` e a primeira migration `drizzle/0000_inicial.sql`.
    - O `test/db.test.ts` confere que as migrations criam todas as tabelas do esquema e que reabrir o banco não reaplica nada.
  - **P1b ✅ Os repositórios no Drizzle** (uma fatia só: há consultas que cruzam tabelas de domínios diferentes).
    - `composition.ts` abre o banco com top-level await (`openDatabase()`) e exporta `database`; testes e scripts o fecham no fim. O PGlite só grava no disco ao fechar, então o `server.ts` fecha no `SIGINT`/`SIGTERM`. O `server.ts` também carrega a composição antes de ouvir: banco fora do ar derruba na subida, não na primeira requisição.
    - Portas, serviços, rotas e o `Access` (`shared/http/access.ts`) ficaram assíncronos.
    - `domains/*/infra/Drizzle*Repository` no lugar dos `Sqlite*` (renomeados com `git mv`), mesmo comportamento: `lower(name)` no lugar do `COLLATE NOCASE` (com o `id` desempatando), `onConflictDoUpdate`/`onConflictDoNothing`, `db.transaction` ao excluir empresa e usuário, o `payload` volta como objeto, e os `count()` do Drizzle já devolvem número (o Postgres devolve `bigint` como texto).
    - Saíram o `shared/db/sqlite.ts`, o `auth.db` e o `createRequire('node:sqlite')`. O teste de fronteira proíbe `drizzle-orm`, `pg` e o PGlite no `domain`.
    - Os dados de demonstração viraram uma função (`src/scripts/demoData.ts`): antes, a demo do TCC dependia de importar o `seedDemo.ts` só para ele rodar. O `seedDemo.ts` e o `scripts/demo/seed.ts` chamam a função e fecham o banco.
    - **Teste novo, `apps/api/test/portal.test.ts`** (no lugar das fumaças da S7, que estavam só no scratchpad): login e conta, equipe, projetos e repositórios, device flow e o painel do admin, pelo HTTP contra o PGlite. Os dois testes que abrem o banco dão 60 s ao `beforeAll`: com a suíte inteira, subir o PGlite passa dos 10 s padrão.
    - Conferido: `npm run check` (440 passando); `bootstrap` duas vezes (a segunda acha o admin, ou seja, gravou), `seed:demo` duas vezes, o `scripts/demo/seed.ts`, e a API no ar com login da conta demo.
  - **P1c ✅ Scripts e documentação** (2026-10-24).
    - `npm run db:migrate -w @shieldepy/api` (`src/scripts/migrate.ts`): abre o banco, diz quantas migrations aplicou e fecha; é o passo do deploy antes de subir a API. O `openDatabase()` passou a devolver `migrationsApplied` (conta as linhas de `drizzle.__drizzle_migrations` antes e depois), e o `test/db.test.ts` confere 1 ou mais na primeira abertura e 0 na segunda.
    - `.env.example` com um bloco "Banco" (`DATABASE_URL`, `SHIELDEPY_DATA_DIR`); `docs/como-funciona.md` com a seção "Banco da API" (PGlite × Postgres, onde ficam os dados, os scripts, como mudar o esquema); a árvore da [0013](docs/decisoes/0013-api-ddd-por-dominio.md) e os comandos do `CLAUDE.md`. O `README.md` da raiz não falava de SQLite, e a `apps/api` não tem README.
    - Conferido: `npm run check` (440 passando); `db:migrate` duas vezes numa pasta temporária (1 aplicada, depois "nenhuma pendente"); `db:generate` sem mudar o esquema diz "No schema changes". **Só o PGlite foi conferido:** não havia um Postgres conhecido à mão (um Postgres de verdade fica para a P2).
    - Não há dados de produção para migrar do SQLite: o dev recria com `npm run seed:demo -w @shieldepy/api` (se houver um `auth.db` antigo em `apps/api/data/`, pode ser apagado).
    - Com a P1c, a P1 inteira está pronta e na `main` (`9d0bc55`).
- **P2. Deploy (depende de DP3 e DP4).** Dockerfile da API, domínio, TLS, variáveis de ambiente e OAuth do Google e do GitHub com as URLs de produção. Workflow de deploy na `main`.
- **P3. Segurança.** Rate limit no login e no device flow, cookies `Secure` e `SameSite`, CSP no site, chaves e segredos fora do repositório, rotação documentada. Revisar com `/security-review` antes de abrir para clientes.
- **P4. Operação.** Backup diário do Postgres com restauração testada uma vez, logs estruturados, alerta de erro e uma página de status simples.
- **P5. LGPD e termos.** Termos de uso, política de privacidade (o que a extensão envia: só com login, e o que vai para o portal), exportação e exclusão de conta.

