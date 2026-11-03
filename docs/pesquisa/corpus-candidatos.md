# Projetos do GitHub para dar variedade ao corpus

**Data:** 2026-11-03 · **Modo:** só leitura e mapa; nenhum caos rodou nestes projetos · **Licenças:** só permissivas ([0023](../decisoes/0023-corpus-so-licencas-permissivas.md))

A pergunta: projetos públicos dão pares para o DPO, e não só registros? Um par real precisa de um commit que corrigiu um defeito que o caos reproduz: achado antes da correção, "aguentou" depois.

## 1. Resumo

- **A busca achou o que queríamos num projeto só:** o `telemetry-tracker` tem correções reais de corrida, com a licença MIT já nos commits antigos.
- **O motor ainda não enxerga esse projeto:** o mapa lê 995 rotas e nenhuma operação. Sem operação não há hipótese, e sem hipótese não há teste.
- **Os projetos que o mapa enxerga não têm commit de correção:** dariam registros, não pares.

## 2. Como foi feito

1. 24 buscas de repositórios na API do GitHub (Express e Fastify com Postgres ou Prisma; MIT ou Apache-2.0; 15 estrelas ou mais): 60 candidatos.
2. O `package.json` de cada um: 25 com Express ou Fastify e `pg` ou Prisma, sem Mongoose, NestJS, TypeORM, Sequelize, Knex ou Drizzle.
3. 13 escolhidos à mão, tirando plugins, GraphQL e projetos sem rotas de negócio.
4. Em cada um: `git log` procurando palavras como `race`, `transaction`, `duplicate` e `timeout` junto de `fix`, e o `topology --json`.

A busca por palavras é grosseira: pode perder correções e traz ruído (no `blagues-api`, os "timeouts" são do bot do Discord). A coluna "Correções" conta só o que a busca trouxe, antes de qualquer leitura.

## 3. A tabela

| Projeto | Pilha | Commits | Rotas no mapa | Com escrita no mapa | Correções |
|---|---|---|---|---|---|
| `Telemetry-Tracker/telemetry-tracker` (`apps/api`) | Fastify, Prisma | 1801 | 995 | 0 | 12+ |
| `Blagues-API/blagues-api` | Fastify, Prisma | 1631 | 10 | 0 | 12+ (ruído) |
| `LeChatErrant/API-template` | Express, Prisma | 2685 | 0 | 0 | 4 |
| `rafael-fu2025/rapa-agent` (`server`) | Fastify, Prisma | 22 | 103 | 2 | 3 |
| `heybereket/snapsaver` (`packages/api`) | Fastify, Prisma | 205 | 8 | 4 | 1 |
| `antonio-lazaro/prisma-express-typescript-boilerplate` | Express, Prisma | 25 | 15 | 11 | 0 |
| `JawherKl/node-api-postgres` | Express, `pg` | 186 | 16 | 10 | 0 |
| `hmake98/fastify-typescript` | Fastify, Prisma | 48 | 5 | 2 | 0 |
| `LivioAlvarenga/API-Rest-Node-SOLID` | Fastify, Prisma | 96 | 11 | 0 | 0 |
| `SojebSikder/nodejs-ecommerce` | Express, Prisma | 235 | 1 | 0 | 0 |
| `geshan/nodejs-posgresql` | Express, `pg` | 75 | 3 | 0 | 0 |
| `taniarascia/node-api-postgres` | Express, `pg` | 9 | 6 | 0 | 0 |
| `nicolabovolato/fastify-node-api` | Fastify, `pg` | 8 | 2 | 0 | 0 |

## 4. Os commits do telemetry-tracker

| Commit | O que corrige | Serve? |
|---|---|---|
| `369bba2` | A corrida ao criar o grupo de erro no `POST /error`: "duplicate-fingerprint ingest no longer 500s". Mexe em `src/services/errors.ts` | O melhor: é o `noUnhandledError` do caos, e a correção está numa função só |
| `4639cc5` | Sessão duplicada numa corrida; muda `ingest.ts` e acrescenta uma migration | Bom, mas a correção depende do esquema |
| `312f2d4` | Identidade antiga sobrescrevendo a nova | A conferir: mistura o pacote `telemetry-core` |
| `3f154b8` | Assinatura duplicada na cobrança | A conferir: mistura mudanças do front |

## 5. Por que o mapa não vê as operações

As rotas ficam em callbacks dentro de uma função de plugin:

```ts
export async function ingestRoutes(app, prisma) {
  app.post("/error", async (request, reply) => {
    const { group } = await findOrCreateErrorGroup(prisma, { ... });
  });
}
```

O callback dentro de função não vira símbolo. É o limite anotado na MVP4c, que vale também para o Express. Além disso, o `prisma` chega por parâmetro. Ainda não foi medido se resolver o callback basta, nem por que há 995 rotas (o mapa repete, por exemplo, `GET /ingest`).

Rodar o `telemetry-tracker` também é mais caro que os outros: é um monorepo com pnpm, Stripe e S3, e o contrato teria de valer em cada commit antigo.
