# O caos em 3 projetos Express reais (C1)

**Data:** 2026-10-24 · **Base:** `main` em `9d0bc55` mais a correção desta tarefa · **Modo:** `chaos --offline` (sem IA, custo zero) · **Projetos:** clonados no scratchpad pelo `npm run mapa:reais -- --dir <pasta> --so realworld,prisma-express,pg-crud`, fixados por commit, com `npm install --ignore-scripts`

## 1. Resumo

- **O caos rodou nos três** e todos os controles passaram, ou seja, os contratos funcionam. Saíram **5 achados verdadeiros**, nenhum falso, mas também **3 "aguentou" que não provam nada** (seção 4).
- **Nenhum `--init` rodou sem edição.** Nos três, o `createApp` foi impossível sem escrever código: o app chama `listen()` no topo e não é exportado. O banco também não veio pronto em nenhum: um não tem esquema, outro não tem migrations, e o Prisma 4 não tem adapter para o PGlite.
- **Um bug do motor foi corrigido nesta tarefa:** o `createApp` do contrato, quando remonta os roteadores, duplicava todas as rotas na topologia, e com elas as hipóteses (teste em `packages/core/test/code-graph/walk.test.ts`).
- **O achado mais importante para a C2: o PGlite em memória esconde corridas.** Ele responde sem devolver a vez ao event loop, então leitura e escrita de uma requisição rodam juntas, antes de a próxima entrar. Sem uma API externa no meio, o teste de corrida dá "aguentou" num código que corre. O banco falso precisa de um `await new Promise((r) => setImmediate(r))` por consulta (seção 3.1).

## 2. A tabela

| | pg-crud | realworld | prisma-express |
|---|---|---|---|
| Repositório | `manfraio/rest_api_with_nodejs_and_postgres` `fdd9fc7` | `gothinkster/node-express-realworld-example-app` `30b68e1` | `prisma/prisma-examples` `caa902a`, `orm/express` |
| Pilha | JS (CommonJS), Express 4, `pg` | TS, Express 4, Prisma 4, `express-jwt` | TS, Express 5, Prisma 7 + `@prisma/adapter-pg` |
| Arquivos indexados, tempo do `graph` | 6, ~2 s | 39, ~2 s | 3 (14 depois do `prisma generate`), ~2,5 s |
| Cobertura provada, por nome, ciclos, colisões | 100%, 0, 0, 0 | 100%, 0, 0, 0 | 100%, 0, 0, 0 |
| Rotas achadas × reais (conferidas à mão) | 10 × 10 | 20 × 20 (19 sensíveis) | 9 × 9 |
| Pendências do `--init` (com `createApp` e `reset`) | 10 | 17 | 9 |
| O que o `--init` errou | nada além de deixar pendente | `GET /api/articles/feed` e `GET /api/user` marcadas "pronta", mas exigem JWT (dariam 401); `:slug` e `:username` preenchidos com `1` | nada além de deixar pendente |
| Instalar (com o arnês de teste) | ~30 s | ~35 s + `prisma generate` 2 s | ~55 s + `prisma generate` |
| Deixar o contrato rodando, à mão | ~15 min | ~30 min | ~15 min |
| Hipóteses (todas com teste) | 2 | 5 | 1 |
| Resultado | 1 achado, 1 aguentou | 4 achados, 1 aguentou | 0 achados, 1 aguentou |
| Achados verdadeiros / falsos | 1 / 0 | 4 / 0 | — |

**Os achados** (todos conferidos lendo o teste e repetindo a requisição à mão):
- **pg-crud, `POST /categories` (Crítico, correto):** checa se o nome existe e depois insere, sem transação nem restrição. 10 requisições simultâneas criam 10 categorias iguais.
- **realworld, `DELETE /api/articles/:slug` e `DELETE …/comments/:id`:** `findFirst` e depois `delete`. Quem perde a corrida recebe 500 ("Record to delete does not exist") em vez de 404.
- **realworld, `POST /api/articles` e `POST /api/users`:** checam a unicidade e depois criam. Quem perde a corrida recebe 500 (`Unique constraint failed` no `slug` e no `email`) em vez de 422.
- Os quatro do realworld são **reais, mas "Crítico" exagera**: as restrições do banco seguraram a integridade (os invariantes passaram), e o defeito é a resposta 500.

## 3. Como cada contrato rodou

O arnês de teste que o `chaos` exige (`vitest` 2.1.9, `supertest` 7, `msw` 2) foi instalado em cada projeto. Nenhum deles o tinha: o realworld usa Jest, os outros não têm testes.

### 3.1 pg-crud: `pg` puro, sem esquema
- **`createApp`:** o `index.js` chama `listen(3000)` no topo. O contrato remonta o app como no `index.js` (`express()`, `express.json()`, os dois `app.use` com `require`).
- **Banco:** o repositório não tem esquema nem migration. As tabelas foram deduzidas do SQL dos controllers. Um `Pool` falso sobre o PGlite, como o do `checkout-express`, mas aceitando também `query({ text, values })`.
- **CommonJS:** o `vi.mock('pg')` não alcança o `require()` nativo. O setup troca o `Pool` direto no módulo em cache: `createRequire(import.meta.url)('pg').Pool = Pool`, antes de o `services/database.js` desestruturar.
- **A corrida escondida:** com o `Pool` igual ao do `checkout-express`, o `POST /categories` deu 201 e nove 409, nenhuma corrida. Com um `setImmediate` antes de cada consulta, deu dez 201 e dez categorias iguais. Num Postgres de verdade sempre há essa pausa (a rede).

### 3.2 realworld: Prisma 4
- **`createApp`:** o `main.ts` chama `listen()` e não exporta. O contrato remonta o app (`bodyParser.json()`, `routes` e o tratador de erro do `main.ts`).
- **Banco:** PGlite com as 4 migrations do próprio projeto, servido pelo protocolo do Postgres numa porta livre (`@electric-sql/pglite-socket` 0.2.11). O setup define a `DATABASE_URL` (`?connection_limit=1`) antes de o Prisma ser importado.
- **Autenticação:** um JWT assinado com o segredo padrão do `auth.ts` em `headers` de 13 das 19 requisições.
- **Limite do socket:** depois de um erro no meio de requisições simultâneas, o `pglite-socket` às vezes quebra a conexão ("unexpected message from server", "Server has closed the connection"). Nos achados acima, o erro verdadeiro do app apareceu em todas as rodadas. Numa rota sem corrida real, porém, esse ruído viraria um achado falso.

### 3.3 prisma-express: Prisma 7, tudo num arquivo
- **`createApp`:** o `src/index.ts` monta o app, cria o Prisma, chama `listen(3000)` e não exporta nada. Sem mexer no projeto, o setup faz `vi.mock('express')`: o `express()` guarda o app criado num global e o `listen()` não abre porta. O contrato importa o `src/index.ts` só pelo efeito.
- **Banco:** o repositório não tem migrations. O SQL saiu de `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` e foi servido pelo `pglite-socket` para o `@prisma/adapter-pg`.
- **`prisma generate`:** pôs 10 arquivos em `prisma/generated`. O mapa os indexa, mas a topologia não muda (9 rotas, 10 operações, 100% provado). É ruído só de nós no grafo.

## 4. Os "aguentou" que não provam nada

- **Requisições iguais:** o teste de corrida manda 10 vezes a mesma requisição. Renomear a categoria 1 dez vezes (pg-crud, `PUT /categories/:id`) ou atualizar o mesmo artigo dez vezes (realworld, `PUT /api/articles/:slug`) nunca duplica nada. A corrida real dessas rotas (duas categorias renomeadas para o mesmo nome) precisa de requisições diferentes.
- **Invariante sem o que aconteceu:** no prisma-express, `PUT /publish/:id` lê `published` e grava o inverso. 10 inversões simultâneas perdem atualizações, mas o invariante não sabe quantas requisições deram certo: o contexto só traz `apiCalls`. Nenhum invariante consegue expressar "o estado final bate com as respostas".

## 5. O que a C2 precisa resolver, em ordem

1. **Banco de teste gerado que mostra a corrida (C2d).** O `--init` gera o `chaos/db.ts` e o `setup.ts`:
   - PGlite com o esquema: migrations do projeto (Prisma, SQL), `prisma migrate diff --from-empty` quando não houver, ou, no `pg` puro, a pendência de escrever o esquema;
   - **um `setImmediate` por consulta**, porque sem ele o teste de corrida dá falso verde;
   - `Pool` falso para o `pg`, com a troca no cache do `require` quando o projeto for CommonJS;
   - para o Prisma, adapter do PGlite onde houver, e o `pglite-socket` só onde não houver. O `reset` é um `TRUNCATE … RESTART IDENTITY CASCADE` das tabelas do esquema.
2. **`createApp` sem editar o projeto (C2a).** Nos três, o app chama `listen` no topo e não é exportado. Duas saídas, nesta ordem: a fábrica exportada, quando existir; senão, o `vi.mock('express')` que guarda o app e anula o `listen` (o que rodou no prisma-express). O contrato que remonta à mão duplica o código do projeto.
3. **Autenticação nas requisições (C2b/C2c).** Quando a rota passa por um middleware de JWT (`express-jwt`, `passport-jwt`), o `--init` não pode marcar "pronta". Ele deixa uma pendência de cabeçalho ou gera o token se achar o segredo.
4. **Parâmetros e corpos (C2b, C2c):** `:slug` e `:username` não são números, e os corpos vazios foram a maior parte das pendências (16 de 36; os parâmetros, 14). O corpo sai das propriedades lidas no handler (`req.body.user.email`) e o parâmetro de um registro do `reset`.
5. **Mais força nos testes de corrida (nova, no `packages/agent/src/chaos/templates.ts`):**
   - requisições variadas (duas entidades diferentes indo para o mesmo valor);
   - o contexto dos invariantes ganha as respostas (status e corpo de cada requisição), e não só `apiCalls`;
   - a severidade de uma corrida em que só o `noUnhandledError` falhou (500 sem estado corrompido) cai de Crítico para Alto.
6. **O arnês de teste no projeto:** o `chaos` exige `vitest`, `supertest` e `msw` instalados no alvo. O `--init` deve dizer o comando de instalação, ou a CLI deve usar os dela.

## 6. Depois da C2a (2026-10-30)

Os mesmos 3 projetos, nos mesmos commits, com o `createApp` gerado pelo `--init` (C2a1). O mapa deu os mesmos números da tabela da seção 2.

| | pg-crud | realworld | prisma-express |
|---|---|---|---|
| Como o `--init` subiu o app | guardado: `index.js` (CommonJS) carregado com `createRequire` | guardado: `import './src/main'` | guardado: `import './src/index'` |
| Pendência do `createApp` | nenhuma | nenhuma | nenhuma |
| Conferido | o `chaos --offline` inteiro | fumaça: 404 numa rota inexistente e a porta 3000 livre | fumaça: 404 numa rota inexistente e a porta 3000 livre |

- **pg-crud:** escritos à mão só o `chaos/schema.sql` (as duas tabelas), os corpos, um registro de exemplo no `resetDb` e a invariante `nomeDeCategoriaUnico`. Saiu o mesmo resultado da C1: `POST /categories` Crítico (`stateCheck: nomeDeCategoriaUnico`) e `PUT /categories/:id` aguentou. Os controles passaram, então o app subiu pelo setup gerado.
- **Sem a invariante, o `POST /categories` dá "aguentou":** dez inserções iguais com 201 não quebram nada que o teste veja (é a seção 4). O esquema da C1 não tinha `UNIQUE`; com ele, o defeito apareceria como 500.
- **realworld e prisma-express:** a entrada importada pelo contrato roda o que está no topo (o `PrismaClient`, o `dotenv`, o `cors`), e nada disso abriu conexão nem porta. O banco deles ainda é à mão (C2d2).
- **Ambiente:** atrás do proxy desta máquina, o `prisma generate` só baixa o binário com `NODE_OPTIONS=--use-system-ca`.
