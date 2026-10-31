# 0019 — No Prisma, o banco de teste é o PGlite servido pela rede (`pglite-socket`), com uma conexão só

**Data:** 2026-10-25 (escolha técnica, na C2d2; portada para a C2a nova em 2026-10-31, na MVP1) · **Estado:** valendo

**Contexto.** O `--init` do caos gera o banco de teste (C2d). No `pg`, o `chaos/db.ts` é um `Pool` falso sobre o PGlite, com uma pausa por consulta (C2d1). O Prisma não aceita isso: ele fala com o banco pelo próprio motor (em Rust, do Prisma 4 ao 6) ou por um driver adapter (obrigatório no Prisma 7, quase sempre o `@prisma/adapter-pg`). Foram consideradas:
- **o adapter do PGlite** (`pglite-prisma-adapter`): roda no mesmo processo, mas só serve no Prisma 7.1+. Exigiria trocar a construção do `PrismaClient` do app (o `adapter` é passado no código dele) e ainda precisaria da pausa, como no `pg`;
- **o `pglite-socket`**: serve o PGlite pelo protocolo do Postgres numa porta livre, e a `DATABASE_URL` aponta para lá. O app não muda, e vale para qualquer versão. Na C1, com a 0.2.11 e uma conexão só, ele às vezes quebrava a conexão depois de um erro no meio de requisições simultâneas.

Na C2d2, a 0.2.14 foi medida no realworld (Prisma 4) e no prisma-express (Prisma 7): 5 rodadas de 10 requisições simultâneas em 4 rotas, com erros no meio, e nenhuma conexão quebrou; os 500 eram todos os erros verdadeiros do app. O servidor agora multiplexa várias conexões e deixa uma transação aberta só com a conexão dela.

**Decisão.**
- No Prisma, o `chaos/db.ts` sobe o PGlite com o esquema e o `PGLiteSocketServer` na porta 0, e define as variáveis do `datasource` (`url` e `directUrl` do `schema.prisma`, lidas por tokens; sem elas, `DATABASE_URL`) antes de o app carregar. Nada no código do app muda.
- **Uma conexão só ao banco.** Com o pool frio, a segunda requisição esperava abrir uma conexão nova, a primeira terminava sozinha, e o teste de corrida passava num código que corre (o `POST /api/articles` do realworld deu "aguentou"). A URL leva `connection_limit=1` (o motor do Prisma 4 a 6), e o `chaos/db.ts` troca o `Pool` do `pg` no módulo em cache por um com `max: 1` (o `adapter-pg` do Prisma 7, que ignora o parâmetro da URL). Com uma conexão, as consultas entram na fila na ordem em que chegam.
- A rede devolve a vez ao event loop a cada consulta, então não há pausa artificial.
- O esquema vem das migrations ao lado do `schema.prisma` (`<pasta>/migrations/*/migration.sql`). Sem elas, o `--init` roda o `prisma migrate diff --from-empty` do próprio projeto e grava o SQL em `chaos/schema.sql`; sem o Prisma instalado, vira pendência com o comando.

**Consequências.**
- O alvo instala também o `@electric-sql/pglite-socket` (o `--init` avisa).
- Com uma conexão, transações de requisições diferentes rodam uma de cada vez. Uma corrida que só existe entre duas transações abertas ao mesmo tempo (sem `FOR UPDATE`) não aparece. É o mesmo limite do banco do `pg` (o PGlite tem uma sessão), e fica escrito no alcance do caos.
- A falha injetada no banco (DB_Chaos) continua só no `pg`: gravar via Prisma ainda é hipótese sem teste.
