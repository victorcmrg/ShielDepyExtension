# Projetos do GitHub para dar variedade ao corpus

**Data:** 2026-11-03 · **Modo:** só leitura e mapa; o caos rodou só no `telemetry-tracker`, em `--offline` (seção 6) · **Licenças:** só permissivas ([0023](../decisoes/0023-corpus-so-licencas-permissivas.md))

A pergunta: projetos públicos dão pares para o DPO, e não só registros? Um par real precisa de um commit que corrigiu um defeito que o caos reproduz: achado antes da correção, "aguentou" depois.

## 1. Resumo

- **A busca achou o que queríamos num projeto só:** o `telemetry-tracker` tem correções reais de corrida, com a licença MIT já nos commits antigos.
- **Atualização (2026-11-03): o motor passou a enxergar esse projeto, e saíram 2 pares reais** (seção 6). Antes, o mapa lia 995 rotas e nenhuma operação; agora são 132 rotas e 1017 operações no topo do repositório.
- **Dos outros, o `rapa-agent` é o que mais ganhou:** de 2 para 92 rotas com escrita, mas ainda sem commit de correção conferido (seção 7).

## 2. Como foi feito

1. 24 buscas de repositórios na API do GitHub (Express e Fastify com Postgres ou Prisma; MIT ou Apache-2.0; 15 estrelas ou mais): 60 candidatos.
2. O `package.json` de cada um: 25 com Express ou Fastify e `pg` ou Prisma, sem Mongoose, NestJS, TypeORM, Sequelize, Knex ou Drizzle.
3. 13 escolhidos à mão, tirando plugins, GraphQL e projetos sem rotas de negócio.
4. Em cada um: `git log` procurando palavras como `race`, `transaction`, `duplicate` e `timeout` junto de `fix`, e o `topology --json`.

A busca por palavras é grosseira: pode perder correções e traz ruído (no `blagues-api`, os "timeouts" são do bot do Discord). A coluna "Correções" conta só o que a busca trouxe, antes de qualquer leitura.

## 3. A tabela

Medida antes de mudar o mapa. A seção 7 traz os números de depois.

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
| `312f2d4` | Identidade antiga sobrescrevendo a nova | Não tentado: mistura o pacote `telemetry-core` |
| `3f154b8` | Assinatura duplicada na cobrança | Não tentado: mistura mudanças do front |

## 5. Por que o mapa não vê as operações

As rotas ficam em callbacks dentro de uma função de plugin:

```ts
export async function ingestRoutes(app, prisma) {
  app.post("/error", async (request, reply) => {
    const { group } = await findOrCreateErrorGroup(prisma, { ... });
  });
}
```

O callback dentro de função não vira símbolo. É o limite anotado na MVP4c, que vale também para o Express.

**Medido em 2026-11-03** (teste em `packages/core/test/topology/fastify.test.ts`): numa miniatura com o callback, a rota dá zero operações; com o mesmo corpo num handler por nome, ela dá as três, inclusive a do serviço em outro arquivo que recebe `prisma: PrismaClient`. Então, com o tipo simples, **a causa é só o símbolo do callback**, e a resolução de chamadas do `CodeGraph` não precisa ser reescrita.

O trecho acima simplifica o projeto: lá, `ingestRoutes` recebe `(app, _opts)` e o `prisma` é um import de `../lib/db.js`. Só o serviço o recebe por parâmetro, em 207 de 222 casos com o tipo simples e em 8 com uma união (`PrismaClient | Prisma.TransactionClient`).

**As 995 rotas eram dois defeitos do motor, não rotas de verdade:**
1. Os plugins escritos no `register` usam todos o parâmetro `f`, e a identidade de um plugin sem símbolo era `arquivo#chamador#f`. Todos viravam a mesma instância, e cada rota saía uma vez por prefixo: o `GET /ingest` era a rota `/` do `publicSurface` com o prefixo de outro plugin. Com o callback virando símbolo ([0029](../decisoes/0029-callback-de-registro-vira-simbolo.md)), cada plugin tem identidade própria.
2. Os `*.test.ts` dentro de `src/` montam os plugins em apps próprios, sem os prefixos. Cada um era mais uma raiz. Agora um arquivo de teste não define rota nem app.

| Commit | Rotas antes | Rotas agora | Repetidas agora |
|---|---|---|---|
| `369bba2~1` | 481 | 97 | 0 |
| `9974b4a` (o topo em 2026-11-03) | 995 | 132 | 0 |

Conferido contra o fonte em `369bba2~1`: 95 registros nos arquivos de rota, mais 2 no `app.ts`, e nenhum `arquivo:linha` se perdeu. O `project-dashboard.ts` caiu de 350 para 50 rotas no topo.

## 6. Os pares reais do telemetry-tracker

Os dois vieram do `dataset:gerar`, com o caos em `--offline`, e repetiram o resultado em 3 rodadas, com o controle verde nos quatro lados.

| Commit | Rota e hipótese | Antes | Depois | Quem enxerga |
|---|---|---|---|---|
| `369bba2` | `POST /ingest/error`, `race_condition` em `errorGroup` | Achado em `dad773b` | Aguentou | O 500 (`noUnhandledError`) |
| `4639cc5` | `POST /ingest/session`, `race_condition` em `session` | Achado em `dcbbc6a` | Aguentou | A invariante `sessaoUnica` (duas linhas, sem 500) |

O que se temia não aconteceu: o app sobe sem Stripe e sem S3, e o código do projeto não muda. O contrato semeia a organização, o projeto e a chave com o mesmo hash que a rota verifica. Cada lado tem o esquema do seu commit: é o que deixa a migration do `4639cc5` valer.

**Cuidados ao usar estes pares:**
- **O caos não diz qual tabela causou a falha.** O `POST /ingest/error` tem 5 hipóteses de corrida, todas com o mesmo teste, e todas dão o mesmo 500. Só a de `errorGroup` é a causa, e é a única que entra no corpus (`keep` no `scripts/dataset-generate.ts`). A escolha vem da leitura do commit, não do motor.
- **`http_5xx` e `malformed_response` davam achado falso:** a rota responde 204 porque o e-mail sai depois da resposta (e, sem a chave, nem sai). Agora o teste sai inválido, porque a falha não disparou.
- **O prompt é grande:** ~36 KB por par, porque a cadeia da rota tem 38 funções. Só uma delas muda no `369bba2`.
- **No Windows, a pasta precisa ser curta:** com o caminho do `package.json` do Prisma perto de 260 caracteres, o Node diz que o `#main-entry-point` "não está definido". O `dataset:gerar` recusa uma pasta funda.

## 7. A triagem depois de mudar o mapa

Em 2026-11-03, com o código antes e depois da mudança, nos mesmos clones (o topo de cada repositório). O código antigo reproduziu a tabela da seção 3.

| Projeto | Rotas | Com escrita | Operações |
|---|---|---|---|
| `Telemetry-Tracker/telemetry-tracker` (`apps/api`) | 995 → 132 | 0 → 45 | 0 → 1017 |
| `rafael-fu2025/rapa-agent` (`server`) | 103 | 2 → 92 | 6 → 423 |
| `heybereket/snapsaver` (`packages/api`) | 8 | 4 | 16 → 30 |
| `Blagues-API/blagues-api` | 10 | 0 → 2 | 0 → 3 |
| `nicolabovolato/fastify-node-api` | 2 → 1 | 0 | 0 |

Nos outros 8, nada mudou. A rota a menos do `fastify-node-api` é a de `test/unit/api/index.test.ts`; as rotas de `src/api/routes/v1/` continuam fora do mapa, e o motivo não foi investigado.

**O `rapa-agent` (MIT) é o próximo candidato, mas ainda não dá par:** os commits que a busca por palavras traz não foram lidos, e os títulos falam de auditoria e de ferramentas, não de corrida. Ele daria registros de código real, com 25 rotas `read-then-write`.
