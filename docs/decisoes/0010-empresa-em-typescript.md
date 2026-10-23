# 0010 — A parte da empresa continua em TypeScript

**Data:** 2026-10-23 · **Estado:** valendo

**Decisão.** `apps/api` e `apps/web` continuam em TypeScript, não em Python.

**Por quê.** O backend e o portal atuais já são TS. O `packages/license` é compartilhado com a extensão. O TDD usa o mesmo Vitest e o PGlite. A linguagem do código que o produto lê não muda isso.
