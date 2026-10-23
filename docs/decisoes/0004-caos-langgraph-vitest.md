# 0004 — Caos: LangGraph.js em TS, testes em Vitest, controle sem caos

**Data:** 2026-10-07 · **Estado:** valendo

**Contexto.** O caos precisa ser gerado só para as rotas sensíveis que a topologia aponta, e rodar no CI do cliente.

**Decisão.**
- Pipeline em **LangGraph.js** dentro de `packages/agent`, sobre o `LLMProvider` que já existe.
- Testes gerados em **Vitest**, com supertest e MSW, rodados com controle (sem caos) e com caos.
- Primeiro alvo: Express + fetch/axios + pg/Prisma. O DB_Chaos (E6) veio depois.

**Consequências.** O LangGraph fica fora do `dist/extension.js`: o "Testar Caos" carrega o `dist/chaos.js` à parte. Se o `extension.js` crescer muito, algo puxou o LangGraph para dentro dele. Em C# e Java, o mapa e a topologia funcionam, mas o caos ainda é só JS/TS.
