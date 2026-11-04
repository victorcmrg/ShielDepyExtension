# O caos no MVP: exemplos e projetos reais (MVP8)

**Data:** 2026-10-31 · **Base:** branch `feat/mvp-caos` depois da MVP6b · **Modo:** `chaos --offline` (sem IA, custo zero) · **Projetos reais:** clonados no scratchpad, fora do repositório, nos commits fixados do `npm run mapa:reais` (e o `fastify-prisma` no commit abaixo), com `npm install --ignore-scripts`

É a tabela para o TCC: o que o motor achou, se o achado é verdadeiro, se os controles passaram e quanto do contrato (`shieldepy.chaos.config.ts`) o `--init` escreveu sozinho. O histórico da C1 está em [`caos-projetos-reais.md`](caos-projetos-reais.md).

## 1. Resumo

- **São 17 achados verdadeiros e nenhum falso: 12 de defeitos plantados nos exemplos e 5 de projetos reais.**
- **Nos 4 exemplos, o motor acerta tudo e não inventa nada.** O `checkout-express` e o `checkout-fastify` (o mesmo checkout em dois frameworks) dão os mesmos 6 achados; as versões `-fixed` dão 4 "aguentou" e 1 inválido, e o portão sai 0. Todo achado tem o controle (a mesma requisição, sem caos) passando.
- **Nos 3 projetos Express reais da C1, o `--init` escreve quase tudo.** Na C1 (2026-10-24), nenhum contrato rodou sem escrever código. Agora o app, o banco de teste e os corpos saem gerados; o que sobra é o esquema SQL (só onde o projeto não tem) e os parâmetros de rota (`:id`, `:slug`).
- **O pg-crud deu de novo o achado da C1** (`POST /categories`, Crítico, verdadeiro), com o app, o banco e os corpos gerados. À mão: o esquema, 2 registros e a invariante.
- **O primeiro Fastify real (fastify-prisma) mostrou um limite:** as rotas são declaradas num objeto e registradas num laço (`for (const route of renderRoutes) fastify.route(route)`), e o mapa não seguia isso: 0 rotas. Com 0 rotas, o caos avisa e sai **2** ("nada foi provado"), em vez de um verde falso. Era uma regressão aberta pela MVP4 (o Fastify saiu da lista da MVP3), corrigida nesta tarefa.
- **Atualização (2026-11-03): o mapa segue esse laço.** O fastify-prisma dá 4 rotas (3 sensíveis) e o `--init` deixa 1 pendência, o esquema. O caos não gera nenhum teste nele: cada rota faz uma operação só no banco, sem API externa, e o catálogo não tem hipótese para isso. O exit 0 quer dizer "nada a testar", não "seguro". Achado real em Fastify veio do `telemetry-tracker`: os 2 pares de [`corpus-candidatos.md`](corpus-candidatos.md).

## 2. A tabela

| Projeto | Pilha | Rotas no mapa (sensíveis) | Pendências do `--init`: C1 → agora | Resultado do caos | Achados verdadeiros / falsos | À mão, além do `--init` |
|---|---|---|---|---|---|---|
| `checkout-express` (exemplo) | TS, Express 4, `pg` | 2 (1) | — → 3 → 2 (esquema, Stripe) | 6 achados, exit 1 | 6 / 0 | o contrato do exemplo é escrito à mão desde a E4 |
| `checkout-express-fixed` | idem, corrigido | 2 (1) | — | 4 aguentou, 1 inválido, exit 0 | — | idem |
| `checkout-fastify` (exemplo, MVP4) | TS, Fastify 5, `pg`, plugin com `prefix` | 2 (1) | — → 3 → 2 (esquema, Stripe) | 6 achados, exit 1 | 6 / 0 | o esquema, 1 registro, a resposta do Stripe, o corpo* e as invariantes |
| `checkout-fastify-fixed` | idem, corrigido | 2 (1) | — | 4 aguentou, 1 inválido, exit 0 | — | idem |
| pg-crud `fdd9fc7` | JS (CommonJS), Express 4, `pg` | 10 (10) | 10 → 7 → 1 (esquema) | 1 achado, 1 aguentou | 1 / 0 | o esquema (2 tabelas) e a invariante `nomeDeCategoriaUnico`; os registros já saem do `seedDb` (M1) |
| realworld `30b68e1` | TS, Express 4, Prisma 4, `express-jwt` | 20 (19) | 17 → 11 → 0 (o zero é só contagem: o JWT não tem marca) | 4 achados (da MVP1**); só com o contrato gerado (M1): 1 achado, `POST /api/users`, e 4 inválidos por falta de JWT | 4 / 0 | o JWT em 13 requisições e as invariantes |
| prisma-express `caa902a` | TS, Express 5, Prisma 7 | 9 (9) | 9 → 6 → 0 (com o `migrate diff` funcionando) | 0 achados, aguentou (repetido em 2026-11-04 só com o contrato gerado) | — | as invariantes |
| fastify-prisma `24fb6c5` | TS, Fastify 3, Prisma 3 | **0** (rotas num laço); 4 (3) desde 2026-11-03 | — → 1 (esquema) | **exit 2**, "nada foi provado"; desde 2026-11-03, 0 hipóteses, exit 0 (nada a testar) | — | o esquema (1 tabela) |
| nest-realworld `c1c2cc4` | TS, NestJS, TypeORM | 21 (20) | — | o caos ainda não roda no NestJS (MVP5) | — | — |

\* No `checkout-fastify`, o contrato foi gerado antes da MVP6 (com a pendência do corpo); com a MVP6, o corpo sai dos campos que o `validateCheckout` lê.
\** O realworld e o prisma-express rodaram de ponta a ponta na MVP1 (2026-10-31, mesmo motor de caos, banco do Prisma pelo `pglite-socket`): os 4 achados da C1 em 3 rodadas no realworld; no prisma-express, o mesmo "aguentou" da C1. Nesta tarefa, só o `--init` foi refeito neles (a MVP6 mudou o contrato, não os testes).

**Os 17 achados verdadeiros são de dois tipos, e só os 5 dos projetos reais medem o motor em código que ele não conhecia.** Os 12 do `checkout` são defeitos plantados de propósito no exemplo: os testes de aceitação conferem que o motor os acha, e a mesma lista aparece nos dois frameworks. Os 5 reais (1 no pg-crud, 4 no realworld) foram conferidos na C1, lendo o teste e repetindo a requisição.

- **checkout (Express e Fastify, 6 em cada, plantados):** a corrida no estoque (lê, cobra no Stripe e só depois grava, sem transação: vende o último item duas vezes), o Stripe sem timeout (o cliente fica pendurado), o 5xx e a resposta inválida do Stripe viram 500, e o pedido não gravado depois de cobrar deixa o cliente cobrado sem pedido (duas hipóteses).
- **pg-crud, `POST /categories` (1, real):** checa se o nome existe e depois insere, sem transação nem restrição: 10 requisições simultâneas criam 10 categorias iguais.
- **realworld (4, reais):** os dois `DELETE` (`findFirst` e depois `delete`: quem perde a corrida recebe 500 em vez de 404) e os dois `POST` de criação (a unicidade checada antes de criar: 500 em vez de 422). Reais, mas "Crítico" exagera: as restrições do banco seguraram a integridade.

## 3. Quanto do contrato saiu automático

O contrato tem 6 partes: subir o app, o banco de teste, zerar o estado, as invariantes, as respostas das APIs externas e uma requisição válida por rota.

| Parte | Na C1 (2026-10-24) | Agora |
|---|---|---|
| `createApp` | à mão nos 3 (o app abre porta no topo e não é exportado) | gerado nos 3 e nos exemplos (Express e Fastify, ESM e CommonJS; C2a, MVP4) |
| Banco de teste | à mão nos 3 | gerado: PGlite no lugar do `pg` (C2d1) e do Prisma (MVP1), com as migrations do projeto ou o `prisma migrate diff`; à mão só o esquema de quem não tem nenhum |
| `reset` | à mão | gerado (`TRUNCATE` de tudo); à mão, os registros que as rotas com `:id` usam |
| Invariantes | à mão | à mão (é o que só o projeto sabe) |
| Respostas das APIs | pendência | pendência (C2e, depois do MVP) |
| Corpos | 16 pendências nos 3 | gerados pelos campos lidos, inclusive no serviço para onde o corpo vai (MVP6, MVP6b) |
| Parâmetros de rota | `1` em todos (14 pendências) | pelo registro que o `seedDb` grava (M1, [0031](../decisoes/0031-registro-de-exemplo-pelo-catalogo.md)): `1` no id, `registro-1` no texto; a marca fica com uuid e rota fora do banco gerado |
| Arnês de teste | `npm install -D` em cada projeto | emprestado da CLI, nada instalado (MVP2) |

## 4. Os limites que a tabela mostra

- **Rotas registradas num laço** (o fastify-prisma): resolvido em 2026-11-03 para uma lista ou um objeto literal do topo de um arquivo, em `for...of` e `forEach`, com `Object.values` ou sem ele. Uma lista que só existe em runtime continua fora: o registro vai para `skipped` e, com 0 rotas, o caos sai 2.
- **Autenticação:** no realworld, 13 requisições precisam de um JWT, e o `--init` não sabe gerar (C2b, depois do MVP).
- **Os "aguentou" que não provam nada** continuam (seção 4 do relatório da C1): requisições iguais no teste de corrida e invariantes sem as respostas (C2g, depois do MVP).
- **O `bcrypt` nativo** do fastify-prisma não compila com `--ignore-scripts`; o app talvez nem subisse no teste (o controle falharia e sairia inválido). Continua sem teste: com 0 hipóteses, nada sobe o app.
- **NestJS:** o mapa lê as rotas pelos decorators (21 no nest-realworld), mas o caos ainda não sobe o app (MVP5, opcional desde a [0028](../decisoes/0028-demo-so-o-motor-e-nest-fora.md)).

## 5. Como repetir

```bash
npm run mapa:reais -- --dir <scratchpad>/reais --so realworld,prisma-express,pg-crud
git clone https://github.com/ryands17/fastify-prisma <scratchpad>/reais/fastify-prisma   # commit 24fb6c5
# em cada projeto: npm install --ignore-scripts (no realworld, --omit=dev e o prisma@4.16.2 com --no-save;
# o prisma generate atrás de proxy precisa de NODE_OPTIONS=--use-system-ca)
npm run cli -- chaos <projeto> --init      # conta as pendências: as linhas com TODO(shieldepy)
npm run cli -- chaos <projeto> --offline   # depois de preencher o que sobrou
```
