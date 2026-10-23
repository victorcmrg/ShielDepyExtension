# 0013 — `apps/api` em DDD, organizada por domínio

**Data:** 2026-10-23 (pedido do usuário) · **Estado:** valendo

**Contexto.** Hoje tudo fica em `auth/`, inclusive empresas, projetos e execuções de caos, e o `routes.ts` tem 486 linhas. Licença e cobrança vão crescer em cima disso.

**Decisão.**

```
apps/api/src/
├── domains/
│   ├── identity/     contas, senhas, sessões web, OAuth, device flow, tokens da extensão
│   ├── companies/    empresas e membros
│   ├── projects/     projetos, repositórios, remotes, tokens de CI
│   ├── chaos-runs/   execuções publicadas pelo CI
│   ├── licensing/    (etapa A)
│   └── billing/      (etapa B)
│       cada um com:
│       ├── domain/       entidades e regras puras, sem I/O
│       ├── application/  casos de uso; recebem os repositórios por interface
│       ├── infra/        repositórios SQL (Sqlite* hoje, Postgres na P1)
│       └── http/         rotas
└── shared/           servidor HTTP, banco (conexão e migrations), config
```

Regras, conferidas pelo teste de fronteira (S4), que lê os imports pela AST do TS:
- `domain` não importa `infra`, `http`, `shared/` nem driver de banco;
- um domínio só usa outro pela `application` dele.

**Consequências.** O TDD da A e da B testa o domínio sem banco, e a P1 troca só a `infra`. A reorganização é a tarefa S7, uma fatia por contexto, sem mudar comportamento.
