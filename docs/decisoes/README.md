# Decisões

Uma decisão por arquivo: o contexto, o que foi decidido e o que isso obriga. Para mudar uma decisão, não reescreva o arquivo antigo. Escreva um novo que diga qual decisão ele substitui e marque o antigo como **Substituída por NNNN**.

| # | Decisão | Data | Estado |
|---|---|---|---|
| [0001](0001-motor-prova-ia-propoe.md) | O motor prova, a IA propõe | 2026-10-07 | valendo |
| [0002](0002-tree-sitter-sem-regex.md) | Código só se lê com Tree-sitter, nunca com regex | 2026-10-07 | valendo |
| [0003](0003-mapa-honesto.md) | Ligação sem prova sai como `heuristic`; o mapa não depende da ordem | 2026-10-07 | valendo |
| [0004](0004-caos-langgraph-vitest.md) | Caos: LangGraph.js em TS, testes em Vitest, controle sem caos | 2026-10-07 | valendo |
| [0005](0005-modo-local-gratis.md) | Modo local grátis: sem conta, tudo o que é determinístico funciona | 2026-10-09 | valendo |
| [0006](0006-ia-byok.md) | IA com a chave do próprio usuário (BYOK) | 2026-10-09 | valendo |
| [0007](0007-linguagens.md) | Linguagens: C# e Java no motor, Python a seguir, motor próprio | 2026-10-16 | valendo (substitui "só JS/TS", de 2026-10-09) |
| [0008](0008-produto-e-empresa.md) | Produto e empresa separados no mesmo monorepo; a API não importa o motor | 2026-10-23 | valendo |
| [0009](0009-modelo-de-venda.md) | Assinatura por empresa; a licença é um direito da conta | 2026-10-23 | valendo |
| [0010](0010-empresa-em-typescript.md) | A parte da empresa continua em TypeScript | 2026-10-23 | valendo |
| [0011](0011-tdd-na-empresa.md) | TDD em toda regra de negócio da empresa | 2026-10-23 | valendo |
| [0012](0012-postgres.md) | Postgres com migrations; PGlite nos testes | 2026-10-23 | valendo; o "sem ORM" foi substituído pela 0015 |
| [0015](0015-drizzle.md) | Drizzle para o esquema, as consultas e as migrations (não Alembic, não Prisma) | 2026-10-23 | valendo |
| [0013](0013-api-ddd-por-dominio.md) | `apps/api` em DDD, organizada por domínio | 2026-10-23 | valendo |
| [0014](0014-organizacao-do-repositorio.md) | Monorepo na raiz, `main` como tronco, plano curto + decisões | 2026-10-23 | valendo |
