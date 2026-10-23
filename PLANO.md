# Plano — ShielDepy como produto

**Escrito em 2026-10-23 e unificado no mesmo dia** na branch `chore/plano-unificado`, criada a partir da `origin/feat/motor-linguagens` (`6493059`, com C# e Java no motor). Dois planos, com papéis separados:
- **este `PLANO.md`:** o que falta para o ShielDepy virar produto e empresa (separação, distribuição, licença, cobrança, produção) e o resto do caos;
- **o [`PLANO-CHAOS.md`](PLANO-CHAOS.md):** o histórico e o desenho do motor (E1–E6, V, R, Q, M, L, J), com o Registro detalhado de cada etapa. Uma etapa nova **do motor** (por exemplo, Python ou caos em C#/Java) continua sendo escrita lá.

Os relatórios de custo da IA ([`RELATORIO-CUSTO-IA.md`](RELATORIO-CUSTO-IA.md)) e de preços ([`RELATORIO-PRECOS-CONCORRENCIA.md`](RELATORIO-PRECOS-CONCORRENCIA.md)) continuam na raiz.

**Letras das etapas:** o `PLANO-CHAOS.md` já usa E1–E6, V, R, Q, C, F, M (mapa em projetos reais), L (motor por linguagem e C#), J (Java) e D1–D6 (tarefas do DB_Chaos). Para não confundir, as etapas novas daqui usam **S, W, G, A, B e P**. A **C** e a **F** são as mesmas dos dois planos.

## Como retomar num chat novo

Leia, nesta ordem:
1. esta seção e "Decisões";
2. "Arquitetura alvo", que diz o que é produto e o que é empresa;
3. a tabela de "Etapas" e a etapa em andamento;
4. o fim do "Registro".

**Onde estamos (2026-10-23):**
- **Na `origin/main`:** E1–E6 (com o DB_Chaos), V1–V3, R, Q, a M (mapa em 12 projetos reais) e a demo do TCC (`npm run demo`).
- **Na `origin/feat/motor-linguagens`, ainda sem merge:** a L (C# no mapa, rotas do ASP.NET Core, EF Core/Dapper/HttpClient) e a J (Java: Spring MVC, Spring Data, JdbcTemplate, RestTemplate/WebClient). Esta branch parte dela. Conferido em 2026-10-23: `npm run check` com 400 testes passando e 4 pulados; `topology` acha as rotas e o I/O em ordem no `pedidos-springboot` e no `pedidos-aspnet`. **Falta o E2E num VS Code real** (perguntar antes, ver o `CLAUDE.md`).
- **Caos:** continua só JS/TS. Em C# e Java, o mapa e a topologia funcionam, mas os testes gerados são Vitest/supertest.
- **C1:** os 7 testes das correções já existem (`packages/core/test/real-express.test.ts`). Falta o `--init` e o `chaos` nos projetos reais (etapa C abaixo).
- **Parte da empresa** (cobrança, licença, produção): nada existe ainda.

## Visão

O ShielDepy é vendido como **assinatura por empresa**. O produto roda na máquina do cliente, e a empresa vende o que só existe com uma conta.

- **O produto é distribuído de graça e às claras:** extensão no VS Code Marketplace e no Open VSX, CLI no npm. O motor determinístico (ciclos, colisões, mapa, topologia, caos offline) roda sem conta, como decidido na R1.
- **O que se paga fica no servidor:** portal, equipe, histórico do caos, portão no CI publicando no portal, política de IA da empresa e suporte. Isso não depende de esconder código do cliente, que é JavaScript e roda na máquina dele.
- **A licença é um direito da conta** (a assinatura ativa da empresa), conferido pela API a cada uso de recurso pago. Uma licença assinada que funciona offline (A3) só entra se aparecer um recurso pago que rode local.
- **Download liberado só depois da compra fica descartado.** Gera atrito para quem paga e não protege nada.

## Decisões

**Tomadas (2026-10-23):**
- Separar **produto** e **empresa** dentro do mesmo monorepo. Separar em dois repositórios só se o produto virar open source ou se outra equipe cuidar da empresa.
- O backend da empresa vira `apps/api`, separado do front (`apps/web`). A API **não importa** o motor (`core`, `extractors`, `agent`, `viewer`).
- **TDD** em toda regra de negócio da empresa (licença, plano, assinatura, assentos, webhooks). Ver "Como testar".
- **Postgres** (confirmado pelo usuário em 2026-10-23) com migrations, antes do primeiro cliente pago. Os testes usam PGlite, que o projeto já usa no `checkout-express`. A P1 vem logo depois da S, para a A e a B já nascerem no Postgres.
- **`apps/api` em DDD, organizada por domínio** (pedido do usuário em 2026-10-23). Cada contexto (identidade, empresas, projetos, execuções de caos e, depois, licenças e cobrança) tem as camadas `domain` (entidades e regras puras, sem I/O), `application` (casos de uso), `infra` (repositórios SQL) e `http` (rotas). O domínio não importa banco nem HTTP, e o acesso a dados passa por interfaces de repositório. Por isso o TDD da A e da B testa o domínio sem banco, e a troca do SQLite pelo Postgres (P1) mexe só na `infra`. Ver S7.

**Herdadas e ainda válidas:**
- **Linguagens (decisão de 2026-10-16, que substituiu a de 2026-10-09 "só JS/TS"):** C# e Java estão no motor (mapa, rotas, I/O). A próxima linguagem é **Python**. O motor continua nosso (Tree-sitter).
- **A parte da empresa (`apps/api`, `apps/web`) continua em TypeScript** (2026-10-23): o backend e o portal atuais já são TS, o `packages/license` é compartilhado com a extensão e o TDD usa o mesmo Vitest e o PGlite. A linguagem do código que o produto lê não muda isso.
- Modo local grátis (R1): sem conta, a extensão faz tudo o que é determinístico.
- O motor prova e a IA propõe. Toda saída da IA é validada, existe caminho offline, e um teste de caos só conta como falha se o controle passou.
- Nada de regex para ler código: só Tree-sitter ou analisador léxico. Regex em texto da IA ou em caminho de arquivo pode.
- IA sempre com a chave do próprio usuário (BYOK) até a medição paga (5e) e uma cota no código.

**Pendentes (decisões do usuário; perguntar antes da tarefa que depende delas):**

| # | Decisão | Opções | Bloqueia |
|---|---|---|---|
| DP1 | Provedor de pagamento | **Asaas**: Pix, boleto e NFS-e automática; o foco é B2B no Brasil. **Stripe**: cartão e clientes de fora | B3 |
| DP2 | Licença do código e visibilidade do repositório | MIT e repositório público, ou "todos os direitos reservados" e repositório privado. O template de CI e o `.vsix` nas Releases dependem disso | tarefas G2–G4, C4 |
| DP3 | Hospedagem da API, do site e do Postgres | Uma VPS com Docker, ou PaaS (Railway, Render, Fly) com Postgres gerenciado (Neon, Supabase) | P2 |
| DP4 | Domínio e e-mail de contato | — | P2, W |
| DP5 | O que cada plano destrava (a tabela de planos) | Ponto de partida: o veredito do relatório de preços, seção 7.3 | B1 |

## Arquitetura alvo

```
shieldepy_p1/
├── packages/            ← PRODUTO (vai para a máquina do cliente)
│   ├── core, extractors, agent, viewer
│   └── license          ← a única ponte: tipos do plano e do direito de uso; a verificação, se a A3 existir
├── apps/
│   ├── vscode, cli      ← PRODUTO
│   ├── api              ← EMPRESA: contas, empresas, projetos, device flow, tokens de CI, execuções de caos,
│   │   │                  planos, assinaturas, webhooks de pagamento, licenças
│   │   └── src/
│   │       ├── domains/<contexto>/{domain,application,infra,http}   ← DDD por domínio (S7)
│   │       └── shared/  ← servidor HTTP, banco (conexão e migrations), config
│   └── web              ← EMPRESA: landing pré-renderizada + portal (React/Vite); só front, fala com a api por HTTP
```

**Regras de fronteira (um teste garante, ver S4):**
- `apps/api` e `apps/web` não dependem de `core`, `extractors`, `agent` nem `viewer`.
- O produto só conhece a empresa pela URL do portal (`shieldepy.webBaseUrl`) e pelo `packages/license`.
- A chave privada de qualquer assinatura fica só na `api`, em variável de ambiente.

## Como testar (TDD)

Na **regra de negócio da empresa** a ordem é: escrever o teste que falha, implementar, refatorar. Teste e código vão **no mesmo commit** da tarefa. No resto, teste depois continua valendo.

| Camada | O que | Como | Escrito antes? |
|---|---|---|---|
| Domínio | Báquina de estados da assinatura, contagem de assentos, cálculo do que o plano destrava, emissão e verificação de licença | Funções puras, Vitest, sem banco | **Sim** |
| Webhook | Cada evento do provedor muda a assinatura do jeito certo. Evento repetido não muda nada (idempotência), evento fora de ordem não volta o estado, assinatura inválida é recusada | Payloads reais gravados em `apps/api/test/fixtures/`, Vitest | **Sim** |
| HTTP | Rotas da API, permissões, erros | `createHandler` com banco temporário (o padrão do `web.test.ts`), PGlite depois da P1 | **Sim** |
| Fronteira | A regra de dependências acima | Teste que lê os `package.json` e os imports | Sim (S4) |
| Ponta a ponta | Compra → webhook → login na extensão → plano ativo → recurso pago liberado; e o caminho inverso: cancelou, perdeu o recurso pago e o motor local continua | Um teste na API com provedor falso e o E2E da extensão | Junto da B |
| Front | As telas novas renderizam e chamam a API certa | Teste de fumaça; animações e landing ficam sem TDD | Não |

**Meta:** `npm run check` sempre verde. Nenhuma tarefa da A, B ou P fecha sem o teste da camada dela.

## Etapas

Ordem: **S → P1 → C (restante) → W → G → A → B → P (resto)**. A P1 (Postgres) vem logo depois da S7, que isola o banco na `infra`. O motivo: a S destrava tudo sem mudar comportamento. A C e a W deixam o produto honesto e utilizável antes de alguém instalar. A G põe o produto na mão das pessoas, de graça. As etapas A, B e P só fazem sentido quando houver quem pague (validar com 5 a 10 times junto da G).

| Etapa | O que | Status |
|---|---|---|
| S | Separação produto × empresa (+ DDD na API) | S1 ✅; em andamento na `feat/separacao-api` |
| C | Motor: terminar o caos utilizável (C1 restante, C2, C2f, C4, F) | C1: testes ✅; falta o `--init` e o `chaos` nos 3 projetos |
| W | Landing honesta | pendente |
| G | Distribuição do produto (npm, Releases, Marketplace, Open VSX) | pendente; depende de DP2 |
| A | Licença: direito de uso por empresa | pendente |
| B | Monetização: planos, assinatura, cobrança, cadastro | pendente; depende de DP1 e DP5 |
| P | Produção: Postgres, deploy, segurança, LGPD | pendente; depende de DP3 e DP4 |
| — | Medição paga da IA (5e) | pendente; só com autorização |
| — | Merge da L e da J na `main` (C# e Java no motor) | pronto na `origin/feat/motor-linguagens`; falta o E2E num VS Code real e o merge (usuário) |
| — | Python no motor | próxima linguagem (decisão de 2026-10-16); a etapa é escrita no `PLANO-CHAOS.md` |
| — | Caos em C# e Java (xUnit/`WebApplicationFactory`, JUnit/Spring Test) | talvez; o mapa e a topologia já funcionam nelas |

---

### S — Separação produto × empresa

**Por que existe:** hoje o backend da empresa (cerca de 2.700 linhas em `apps/frontend/server/`) e o front estão no mesmo pacote. O mesmo processo carrega as gramáticas do Tree-sitter e a IA para servir `/analyze` e `/chat`. Qualquer mudança de cobrança ou de licença mexeria no pacote que também roda o motor.

- **S1. `apps/api`.** ✅ Mover `apps/frontend/server/` para `apps/api/src/` sem mudar comportamento: mesmas rotas e mesmo banco. Os testes `web.test.ts`, `chaos-runs.test.ts` e `remotes.test.ts` vão junto e continuam passando. Em dev, o Vite faz proxy de `/api` para ela.
  - **Pronto quando:** `npm run check` verde, `npm run web:dev` abre o portal e o login, e o device flow da extensão funciona contra a API nova.
- **S2. `apps/web`.** Renomear `apps/frontend` para `apps/web`, que fica só com o front e os scripts de build e prerender. Servir o build: a API serve os estáticos em produção (mais simples) ou um CDN (decidir na P2, conforme DP3).
- **S3. Tirar o motor da API.** Remover `/analyze`, `/chat` e a página "Ferramenta" (`Tool.tsx`, `app.html`). Eles rodam o motor no servidor da empresa e duplicam o que a extensão e a CLI fazem. A seção `Demo` da landing continua: é animação, não chama o motor. Se uma demo ao vivo for pedida depois, ela vira um serviço à parte.
  - **Antes de remover:** conferir se algum link do portal ou da landing aponta para `/tool` e trocar pelo de "Instalar a extensão".
- **S4. Teste de fronteira.** Um teste que falha se `apps/api` ou `apps/web` passarem a depender de `core`, `extractors`, `agent` ou `viewer`, seja por `package.json` ou por import.
- **S5. Remover `legacyRoutes.ts`.** Ele redireciona páginas `.html` antigas, e a extensão já usa `/device-confirm` (`AuthService.ts:184`). Nenhuma versão com os endereços antigos foi publicada.
- **S6. Documentação.** Atualizar os READMEs, o `.vscode/launch.json`, os scripts do `package.json` da raiz e o `.env.example` com os nomes novos.
- **S7. DDD por domínio na `apps/api`.** Reorganizar `src/` em `domains/<contexto>/{domain,application,infra,http}` e `shared/`. Os contextos são `identity` (contas, senhas, sessões web, OAuth, device flow e tokens da extensão), `companies` (empresas e membros), `projects` (projetos, repositórios, remotes e tokens de CI) e `chaos-runs` (execuções publicadas pelo CI). Depois vêm `licensing` (A) e `billing` (B).
  - O domínio não importa `node:sqlite`, `http` nem `shared/`. Os casos de uso recebem os repositórios por interface. O SQL atual vira `infra/Sqlite*Repository`, que a P1 troca por Postgres.
  - O teste de fronteira (S4) ganha a regra das camadas: `domain` não importa `infra`, `http` nem driver de banco; um domínio só usa outro pela `application` dele. A checagem lê os imports pela AST do TS.
  - Sem mudar comportamento: as rotas e os testes de HTTP (`web.test.ts`, `chaos-runs.test.ts`) continuam passando. Uma fatia (e um commit) por contexto.

---

### C — Motor: caos utilizável (continua da etapa C antiga)

**Por que existe:** o caos é o diferencial (nenhum concorrente levantado gera caos pela topologia), mas só roda em Express + pg/Prisma + fetch/axios, e com um contrato escrito à mão. A M (no `PLANO-CHAOS.md`) já pôs o Mongoose e os padrões CommonJS no mapa e na topologia, mas o DB_Chaos só injeta falha no `pg`.

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

- **W1.** Aplicar a tabela 7.4 de [`RELATORIO-PRECOS-CONCORRENCIA.md`](RELATORIO-PRECOS-CONCORRENCIA.md):
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

---

## Combinados com o usuário (seguir sem perguntar)

- Responder **em português**.
- Trabalhar **tarefa por tarefa**. Cada uma termina com testes passando, este plano atualizado (✅ e uma linha no Registro) e **um commit** na branch da etapa, no mesmo commit da mudança. Mensagem de commit em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Push só quando o usuário pede** (ele sincroniza entre máquinas). Nunca abrir PR nem fazer merge na `main` sem ele pedir. No fim da etapa, avisar e oferecer título e descrição do PR.
- **Cuidado com a máquina** (o `CLAUDE.md` tem os detalhes): perguntar antes de abrir o VS Code, o Chrome ou o E2E, e rodar uma coisa pesada por vez.
- **Outra pessoa também trabalha neste repositório.** Antes de começar uma etapa, conferir `git status` e a branch. Nunca reescrever histórico nem trabalhar direto na `main`.
- Gastar com a API da IA, mexer no GitHub (segredos, Releases, Marketplace) e escolher provedor ou hospedagem: **só com autorização do usuário**.
- Escolhas técnicas: decidir, registrar aqui o porquê e avisar no resumo.
- Clonar projetos públicos para validar o motor: no scratchpad, fora do repositório. Rodar `npm install --ignore-scripts`.

## Como rodar (de `shieldepy_p1/`)

- `npm run check`: typecheck + testes unitários (404 passando em 2026-10-23, depois da S1).
- `npm run mapa:reais`: clona os projetos reais fixados por commit (fora do repositório) e mede o mapa.
- `npm run demo` / `npm run demo:verificar`: a demo do TCC (perguntar antes: abre o VS Code).
- `npm run build:vscode`: gera `dist/extension.js` (~640 KB; se crescer muito, o LangGraph entrou nele) e `dist/chaos.js` (~1,9 MB, carregado só pelo "Testar Caos").
- `npm run test:e2e -w shieldepy`: E2E num VS Code real (33/33). O cenário de caos precisa de `npm install` em `examples/checkout-express`.
- `npm run package:vscode`: gera o `.vsix`. Para testar o pacote, instale num `--extensions-dir` temporário e rode `SHIELDEPY_E2E_EXTENSION=<pasta> node apps/vscode/test-e2e/run.mjs`.
- `npm run web:dev`: portal em desenvolvimento. Na extensão, `"shieldepy.webBaseUrl": "http://localhost:3000"` nas settings.
- `npm run cli -- chaos examples/checkout-express --offline [--report arq.md]`: exit 1 no vulnerável e 0 no `-fixed`.
- No Windows, os caminhos podem ter acento e espaço: use aspas. Os arquivos estão em CRLF.

## O que saiu na limpeza de 2026-10-23 e por quê

| Item | Destino | Motivo |
|---|---|---|
| `PLANO-CHAOS.md` | **mantido** (decisão da unificação) | É o plano do motor e o Registro detalhado de todas as etapas, inclusive as do colega (M, L, J, E6). O que vale para o produto (C, F, combinados, como rodar) foi trazido para cá |
| Fases 0–4, "Exemplo de validação", "Arquivos críticos" | removidos | O desenho original do pipeline, já entregue |
| E3 e E4 "contexto", custo da E3 | removidos | Já entregues; o custo está em `RELATORIO-CUSTO-IA.md` |
| "Java e C# fora do roadmap" | **corrigido na unificação** | A decisão de 2026-10-16 trouxe os dois de volta, e as etapas L e J os entregaram. Python é a próxima |
| C3 com a F3 primeiro | reordenada | A F3 provava o caos no próprio portal, que deixa de rodar o motor (S3) |
| C5 (release só do `.vsix`) | virou a etapa G | O release agora inclui npm, Marketplace, Open VSX e workflow |
| Proposta "M" do relatório de preços | virou as etapas A, B e P | Detalhada com a separação produto × empresa e TDD |
| `RELATORIO-CUSTO-IA.md`, `RELATORIO-PRECOS-CONCORRENCIA.md` | mantidos na raiz | São pesquisa datada, não plano; base de DP5, da W e do custo da IA |
| `legacyRoutes.ts`, `/analyze`, `/chat`, página "Ferramenta" | ainda no código; viram as tarefas S3 e S5 | Remover código pede teste e cuidado. Não foram removidos nesta limpeza |

## Registro

- 2026-10-23: plano reescrito para estruturar o ShielDepy como produto (branch `chore/plano-produto`, criada a partir da `feat/caos-utilizavel`). Nenhum código mudou.
- 2026-10-23: **plano unificado** com a linha do colega, na branch `chore/plano-unificado`, criada a partir da `origin/feat/motor-linguagens` (`6493059`). A `chore/plano-produto` partia de antes da M, da L e da J, e dizia que Java e C# estavam fora. Mudanças:
  - o `PLANO-CHAOS.md` fica como plano do motor;
  - as etapas novas daqui trocaram de letra para não colidir com as do colega: Distribuição D→**G**, Licença L→**A**, Monetização M→**B**;
  - "Onde estamos", as decisões de linguagem, a C1 (testes já feitos), a F6 (Mongoose no mapa) e os combinados (push, cuidado com a máquina) foram atualizados;
  - **decidido:** a parte da empresa continua em TypeScript (ver "Decisões").

  Conferido nesta branch: `npm run check` com 400 testes passando e 4 pulados; `topology` no `pedidos-springboot` e no `pedidos-aspnet`. Nenhum código mudou.
- 2026-10-23: **S1** (branch `feat/separacao-api`). `apps/frontend/server` virou `apps/api/src` (`@shieldepy/api`: `start`, `dev`, `bootstrap`, `seed:demo`) e os testes foram para `apps/api/test`, sem mudar comportamento. A API serve o build em `apps/frontend/dist` (ou em `SHIELDEPY_STATIC_DIR`). O banco agora fica em `apps/api/data`, ainda no `.gitignore`, e o `SHIELDEPY_DATA_DIR` continua valendo. O `dev.mjs` sobe a API com `cwd` em `apps/api`. A demo (`scripts/demo/seed.ts`, `demo.mjs`) e o `.claude/launch.json` apontam para o lugar novo. `npm run check`: 404 passando. A API subiu com `npm start -w @shieldepy/api` e respondeu em `/api/account`. Falta conferir o `web:dev` no navegador e o device flow no VS Code (pedir antes).
  - **Decidido com o usuário:** DDD por domínio na `apps/api` (nova tarefa S7) e Postgres (P1 logo depois da S).
