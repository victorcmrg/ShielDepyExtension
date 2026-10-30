# Plano — ShielDepy

O que está sendo feito agora e o que falta. É curto de propósito: as decisões tomadas ficam em [`docs/decisoes/`](docs/decisoes/), o registro de cada tarefa é o commit, e o histórico das etapas antigas (E1–E6, V, R, Q, M, L, J) está em [`docs/historico/`](docs/historico/), só para consulta.

## Como retomar num chat novo

1. O `CLAUDE.md` tem os combinados e os comandos.
2. Ler "Onde estamos" e a etapa em andamento, mais abaixo.
3. Ler as decisões que a etapa cita, em [`docs/decisoes/`](docs/decisoes/README.md).
4. Rodar `git log --oneline -15` para ver as últimas tarefas feitas.

## Onde estamos (2026-10-24)

- **Pronto:** o motor (mapa, topologia e caos em JS/TS; mapa, rotas e I/O em C# e Java), a extensão, a CLI, o portal com o histórico do caos e a demo do TCC. Como funciona: [`docs/como-funciona.md`](docs/como-funciona.md).
- **Reorganização de 2026-10-23** ([0014](docs/decisoes/0014-organizacao-do-repositorio.md)) ✅: o monorepo virou a raiz, as decisões viraram arquivos e o plano encolheu. Está na `main`, e as branches antigas do GitHub foram apagadas.
- **Etapa S ✅** (S1 a S7) e **P1 ✅** (Postgres com Drizzle, decisão [0015](docs/decisoes/0015-drizzle.md)): na `main` desde 2026-10-24 (`9d0bc55`, merge fast-forward da `feat/postgres-drizzle`). A `apps/api` é `shared/` + `domains/{identity,companies,projects,chaos-runs}` + `composition.ts`, sobre Postgres/PGlite. Noutra máquina: `git pull` na `main` e `npm install` na raiz. Se aparecer uma pasta `shieldepy_p1/` não rastreada, é resto do layout antigo e pode ser apagada.
- **Em andamento: etapa C**, na branch `feat/caos-c2a`. **C1 ✅** (2026-10-24): o caos rodou nos 3 projetos reais; resultado e lista para a C2 em [`docs/pesquisa/caos-projetos-reais.md`](docs/pesquisa/caos-projetos-reais.md). **C2 em andamento:** C2d1 ✅ (banco de teste gerado para o `pg`). A C1 e a C2d1 estão na `main` desde 2026-10-30 (`8dda696`, merge fast-forward da `feat/caos-c1`; as branches já mergeadas foram apagadas no GitHub). **Agora: C2a** (`createApp` sem editar o projeto; o passo a passo está na tarefa C2a, mais abaixo), depois a C2d2 (Prisma).
- **Falta conferir num VS Code real** (perguntar antes): o E2E da L e da J, e o device flow da extensão contra a `apps/api`.
- **Parte da empresa** (licença, cobrança, produção): nada existe ainda.

## Decisões pendentes (do usuário; perguntar antes da tarefa que depende delas)

| # | Decisão | Opções | Bloqueia |
|---|---|---|---|
| DP1 | Provedor de pagamento | **Asaas**: Pix, boleto e NFS-e automática; o foco é B2B no Brasil. **Stripe**: cartão e clientes de fora | B3 |
| DP2 | Licença do código e visibilidade do repositório | MIT e repositório público, ou "todos os direitos reservados" e repositório privado. O template de CI e o `.vsix` nas Releases dependem disso | G2–G4, C4 |
| DP3 | Hospedagem da API, do site e do Postgres | Uma VPS com Docker, ou PaaS (Railway, Render, Fly) com Postgres gerenciado (Neon, Supabase) | P2 |
| DP4 | Domínio e e-mail de contato | — | P2, W |
| DP5 | O que cada plano destrava (a tabela de planos) | Ponto de partida: [`docs/pesquisa/precos-concorrencia.md`](docs/pesquisa/precos-concorrencia.md), seção 7.3 | B1 |

## Etapas

Ordem: **S → P1 → C (restante) → W → G → A → B → P (resto)**.
- A S destrava tudo sem mudar comportamento, e a P1 (Postgres) vem logo depois da S7, que isola o banco na `infra`.
- A C e a W deixam o produto honesto e utilizável antes de alguém instalar.
- A G põe o produto na mão das pessoas, de graça.
- A A e a B só fazem sentido quando houver quem pague (validar com 5 a 10 times junto da G).

| Etapa | O que | Status |
|---|---|---|
| S | Separação produto × empresa + DDD na API ([0008](docs/decisoes/0008-produto-e-empresa.md), [0013](docs/decisoes/0013-api-ddd-por-dominio.md)) | ✅ (S1 a S7) |
| P1 | Postgres e migrations com Drizzle ([0012](docs/decisoes/0012-postgres.md), [0015](docs/decisoes/0015-drizzle.md)) | ✅ (P1a a P1c; na `main`) |
| C | Motor: terminar o caos utilizável (C1 restante, C2, C2f, C4, F) | C1 ✅, C2d1 ✅ (na `main`); agora: C2a (branch `feat/caos-c2a`) |
| W | Landing honesta | pendente |
| G | Distribuição do produto (npm, Releases, Marketplace, Open VSX) | pendente; depende de DP2 |
| A | Licença: direito de uso por empresa ([0009](docs/decisoes/0009-modelo-de-venda.md), TDD [0011](docs/decisoes/0011-tdd-na-empresa.md)) | pendente |
| B | Monetização: planos, assinatura, cobrança, cadastro (TDD) | pendente; depende de DP1 e DP5 |
| P | Produção: deploy, segurança, operação, LGPD | pendente; depende de DP3 e DP4 |
| — | Medição paga da IA (5e) | só com autorização |
| — | Python no motor ([0007](docs/decisoes/0007-linguagens.md)) | próxima linguagem; escrever a etapa aqui quando começar |
| — | Caos em C# e Java (xUnit/`WebApplicationFactory`, JUnit/Spring Test) | talvez |

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
- **C2. Contrato quase automático.** Meta: num projeto Express suportado, o `--init` gera um contrato que roda sem edição ou com no máximo 1 pendência. **Ordem, pela C1:** C2d1 ✅ → C2a → C2d2 → autenticação → C2b/C2c → testes de corrida mais fortes (C2g) → arnês de teste no projeto (C2h). O detalhe de cada uma está na seção 5 do relatório da C1.
  - **C2a — próxima: `createApp` sem editar o projeto.** Na C1, nenhum dos três exportava o app; nos três, o arquivo que monta o app chama `listen()` no topo. Detalhe para começar num chat novo:
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

