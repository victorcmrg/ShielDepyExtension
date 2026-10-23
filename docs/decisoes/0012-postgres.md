# 0012 — Postgres com migrations; PGlite nos testes

**Data:** 2026-10-23 (confirmado pelo usuário) · **Estado:** valendo

**Decisão.**
- O banco da API passa do `node:sqlite` para **Postgres**, com migrations versionadas em SQL puro e um executor simples (sem ORM, como o código atual).
- Os testes usam **PGlite** (Postgres em processo), que o projeto já usa no `checkout-express`.
- A troca (P1) vem logo depois da S, para que a A e a B nasçam no Postgres.

**Consequências.** Com a [0013](0013-api-ddd-por-dominio.md), a troca mexe só nos `infra/*Repository`. A hospedagem do Postgres é a DP3 (ver `PLANO.md`).
