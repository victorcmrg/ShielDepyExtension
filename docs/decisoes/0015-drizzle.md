# 0015 — Drizzle para o esquema, as consultas e as migrations

**Data:** 2026-10-23 (escolha do usuário) · **Estado:** valendo · **Substitui:** o "SQL puro com um executor simples, sem ORM" da [0012](0012-postgres.md) (o resto da 0012 continua: Postgres, PGlite nos testes)

**Contexto.** A P1 troca o `node:sqlite` pelo Postgres. O usuário quer o deploy automático e a criação do banco sem passos à mão. Foram consideradas:
- SQL puro, a decisão anterior;
- Prisma: pesado, com geração de código, e briga com os repositórios do DDD;
- Kysely: só monta consultas, sem migrations;
- Alembic: é Python. Pediria um segundo runtime no deploy e no CI, e um esquema em Python separado das consultas em TS, sem nada que garanta que os dois batem. Os testes também não migrariam pelo mesmo caminho, porque o PGlite roda dentro do Node.

**Decisão.**
- **Drizzle ORM** (`drizzle-orm`) para o esquema e as consultas. As consultas ficam só na `infra` de cada domínio ([0013](0013-api-ddd-por-dominio.md)).
- O esquema fica num arquivo só, `apps/api/src/shared/db/schema.ts`, dividido por domínio. Há chaves estrangeiras entre domínios, e o histórico de migrations é um só. Se cada domínio declarasse o próprio, a `infra` de um importaria a de outro, e o teste de camadas proíbe isso.
- **`drizzle-kit generate`** (`npm run db:generate -w @shieldepy/api`) gera a migration em SQL versionado em `apps/api/drizzle/`. Ela vai no mesmo commit da mudança de esquema e passa pela revisão do PR.
- **A API aplica as migrations pendentes ao abrir o banco** (`shared/db/postgres.ts`). O deploy só precisa de `DATABASE_URL`.
- **Sem `DATABASE_URL`, a API usa o PGlite** (Postgres em WebAssembly) gravado em `apps/api/data/pglite`. O desenvolvimento e os testes não instalam nada, e o SQL é o mesmo Postgres da produção.

**Consequências.**
- O acesso ao banco é assíncrono: as portas, os serviços e as rotas passam a ser `async` (P1b).
- Datas continuam em milissegundos (`bigint` em modo number). E-mails continuam guardados em minúsculas pelo código, porque o Postgres não tem o `COLLATE NOCASE` do SQLite.
- Mudou o esquema sem gerar a migration? O `db.test.ts` pega: ele compara as tabelas criadas pelas migrations com as do esquema.
