# Plano — ShielDepy

O que está sendo feito agora e o que falta. É curto de propósito: as decisões tomadas ficam em [`docs/decisoes/`](docs/decisoes/), o registro de cada tarefa é o commit, e o histórico das etapas antigas (E1–E6, V, R, Q, M, L, J) está em [`docs/historico/`](docs/historico/), só para consulta.

## Como retomar num chat novo

1. O `CLAUDE.md` tem os combinados e os comandos.
2. Ler "Onde estamos" e a etapa em andamento, mais abaixo.
3. Ler as decisões que a etapa cita, em [`docs/decisoes/`](docs/decisoes/README.md).
4. Rodar `git log --oneline -15` para ver as últimas tarefas feitas.

## Onde estamos (2026-10-23)

- **Pronto:** o motor (mapa, topologia e caos em JS/TS; mapa, rotas e I/O em C# e Java), a extensão, a CLI, o portal com o histórico do caos e a demo do TCC. Como funciona: [`docs/como-funciona.md`](docs/como-funciona.md).
- **Reorganização de 2026-10-23** ([0014](docs/decisoes/0014-organizacao-do-repositorio.md)) ✅: o monorepo virou a raiz, as decisões viraram arquivos e o plano encolheu. Está na `main`, e as branches antigas do GitHub foram apagadas.
- **Em andamento:** a etapa **S** (S1 a S6 e S7a a S7c ✅), na branch `feat/separacao-web`.
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
| S | Separação produto × empresa + DDD na API ([0008](docs/decisoes/0008-produto-e-empresa.md), [0013](docs/decisoes/0013-api-ddd-por-dominio.md)) | S1 a S6 e S7a a S7c ✅; próxima: S7d (`companies`) |
| P1 | Postgres e migrations ([0012](docs/decisoes/0012-postgres.md)) | depois da S |
| C | Motor: terminar o caos utilizável (C1 restante, C2, C2f, C4, F) | C1: testes ✅; falta o `--init` e o `chaos` nos 3 projetos |
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
  - Fatias: **S7a ✅ `shared/`** (`db/sqlite.ts`, `http/{http,static,rateLimiter}.ts`, `crypto/{tokens,passwords}.ts`; o `app.ts` só monta; as regras das camadas no `boundary.test.ts`) → **S7b ✅ `chaos-runs`** (domain: upload, execução e token de CI; application: `ChaosRunService` com portas; infra: `SqliteChaosRunRepository`, `SqliteCiTokenRepository`; http: as 6 rotas; teste do domínio com repositórios em memória; as checagens de acesso foram para `auth/guards.ts` até a S7c/S7e) → **S7c ✅ `projects`** (domain: projeto, visibilidade `canSee`, remote; application: `ProjectService`; infra: `SqliteProjectRepository`; http: CRUD, repositórios, membros, `workspace` e o `repos/check` da extensão; a montagem de todos os domínios passou para `src/composition.ts`, e as rotas de `chaos-runs` recebem o `ProjectService` pela application; as rotas de equipe ficam em `auth/teamRoutes.ts` até a S7d) → S7d `companies` → S7e `identity` (o que sobrar da `auth/`, que então some).

---

### C — Motor: caos utilizável (continua da etapa C antiga)

**Por que existe:** o caos é o diferencial (nenhum concorrente levantado gera caos pela topologia), mas só roda em Express + pg/Prisma + fetch/axios, e com um contrato escrito à mão. A M (ver `docs/historico/PLANO-CHAOS.md`) já pôs o Mongoose e os padrões CommonJS no mapa e na topologia, mas o DB_Chaos só injeta falha no `pg`.

- **C1. Caos em 3 projetos Express reais (restante).** Os projetos são `gothinkster/node-express-realworld-example-app` (`30b68e1`), `prisma/prisma-examples` na pasta `orm/express` (`caa902a`) e `manfraio/rest_api_with_nodejs_and_postgres` (`fdd9fc7`). Clonar no scratchpad, fora do repositório. O `npm run mapa:reais` já clona e mede esses e outros 9 projetos.
  1. ✅ **Um teste por correção** (as 7 da `3799732`), em `packages/core/test/real-express.test.ts`, bloco "C1".
  2. Conferir rotas à mão num recorte e rodar `npm run cli -- chaos <pasta> --init` nos três. Registrar as pendências e o que o mapa errou.
  3. `npm install --ignore-scripts`, deixar o contrato rodando (PGlite para o `pg`; SQLite ou PGlite com adapter para o Prisma; no Prisma 7, rodar `prisma generate` e ver se o gerado vira ruído no mapa) e rodar `chaos --offline --report`. Abrir os testes gerados para julgar os achados.
  4. Fechar no Registro a tabela (tamanho, cobertura, rotas achadas × reais, pendências do `--init`, tempo para o contrato rodar, achados verdadeiros e falsos) e a lista ordenada para a C2.
- **C2. Contrato quase automático.** Meta: num projeto Express suportado, o `--init` gera um contrato que roda sem edição ou com no máximo 1 pendência.
  - **C2a. `createApp`:** onde o `express()` é montado e exportado. Não importar o arquivo que chama `listen`.
  - **C2b. Corpos válidos:** zod ou joi → class-validator → tipo TS do `req.body` → propriedades lidas no handler.
  - **C2c. Parâmetros de rota com tipo:** por exemplo, uuid.
  - **C2d. `reset` e banco de teste:** Prisma `deleteMany` ou banco de teste; pg com PGlite a partir das migrações.
  - **C2e. `apis` com resposta saudável:** SDKs conhecidos; senão `{}` com pendência.
  - **C2f. Aviso de "framework não suportado":** quando a topologia dá 0 rotas e há Fastify, Nest, Koa, Hono, Next ou `node:http` nas dependências. Evita o falso verde silencioso, e **sai antes da G**.
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

- **P1. Postgres e migrations** (logo depois da S; Postgres confirmado em 2026-10-23). Trocar o `node:sqlite` por Postgres com migrations versionadas: SQL puro com um executor simples, para seguir o estilo atual sem ORM. Com a S7, a troca fica nos `infra/*Repository` de cada domínio. Os testes usam PGlite. Script de migração dos dados de demo.
- **P2. Deploy (depende de DP3 e DP4).** Dockerfile da API, domínio, TLS, variáveis de ambiente e OAuth do Google e do GitHub com as URLs de produção. Workflow de deploy na `main`.
- **P3. Segurança.** Rate limit no login e no device flow, cookies `Secure` e `SameSite`, CSP no site, chaves e segredos fora do repositório, rotação documentada. Revisar com `/security-review` antes de abrir para clientes.
- **P4. Operação.** Backup diário do Postgres com restauração testada uma vez, logs estruturados, alerta de erro e uma página de status simples.
- **P5. LGPD e termos.** Termos de uso, política de privacidade (o que a extensão envia: só com login, e o que vai para o portal), exportação e exclusão de conta.

