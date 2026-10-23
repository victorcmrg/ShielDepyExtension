# 0011 — TDD em toda regra de negócio da empresa

**Data:** 2026-10-23 · **Estado:** valendo

**Decisão.** Na regra de negócio da empresa (licença, plano, assinatura, assentos, webhooks) a ordem é: teste que falha, implementação, refatoração. O teste e o código vão no mesmo commit. No resto, teste depois continua valendo.

| Camada | Como | Teste antes? |
|---|---|---|
| Domínio (`domain/`, ver [0013](0013-api-ddd-por-dominio.md)) | Funções puras, Vitest, sem banco | **Sim** |
| Webhook | Payloads reais gravados em `apps/api/test/fixtures/`; idempotência, evento fora de ordem e assinatura inválida | **Sim** |
| HTTP | `createHandler` com banco temporário (PGlite depois da P1) | **Sim** |
| Fronteira | Lê os `package.json` e os imports pela AST do TS | Sim (S4) |
| Ponta a ponta | Compra → webhook → login na extensão → recurso pago liberado, e o caminho inverso | Junto da B |
| Front | Teste de fumaça das telas novas | Não |

**Consequências.** `npm run check` sempre verde. Nenhuma tarefa da A, da B ou da P fecha sem o teste da camada dela.
