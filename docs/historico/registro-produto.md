# Registro do plano de produto (até 2026-10-23)

Arquivado na reorganização de 2026-10-23. Daqui em diante, o registro de cada tarefa é a mensagem do commit e a descrição do PR, e as decisões ficam em [`docs/decisoes/`](../decisoes/).

### O que saiu na limpeza de 2026-10-23 e por quê

| Item | Destino | Motivo |
|---|---|---|
| `PLANO-CHAOS.md` | **mantido** (decisão da unificação) | É o plano do motor e o Registro detalhado de todas as etapas, inclusive as do colega (M, L, J, E6). O que vale para o produto (C, F, combinados, como rodar) foi trazido para cá |
| Fases 0–4, "Exemplo de validação", "Arquivos críticos" | removidos | O desenho original do pipeline, já entregue |
| E3 e E4 "contexto", custo da E3 | removidos | Já entregues; o custo está em `RELATORIO-CUSTO-IA.md` |
| "Java e C# fora do roadmap" | **corrigido na unificação** | A decisão de 2026-10-16 trouxe os dois de volta, e as etapas L e J os entregaram. Python é a próxima |
| C3 com a F3 primeiro | reordenada | A F3 provava o caos no próprio portal, que deixa de rodar o motor (S3) |
| C5 (release só do `.vsix`) | virou a etapa G | O release agora inclui npm, Marketplace, Open VSX e workflow |
| Proposta "M" do relatório de preços | virou as etapas A, B e P | Detalhada com a separação produto × empresa e TDD |
| `RELATORIO-CUSTO-IA.md`, `RELATORIO-PRECOS-CONCORRENCIA.md` | mantidos na raiz | São pesquisa datada, não plano; base de DP5, da W e do custo da IA |
| `legacyRoutes.ts`, `/analyze`, `/chat`, página "Ferramenta" | ainda no código; viram as tarefas S3 e S5 | Remover código pede teste e cuidado. Não foram removidos nesta limpeza |

### Registro

- 2026-10-23: plano reescrito para estruturar o ShielDepy como produto (branch `chore/plano-produto`, criada a partir da `feat/caos-utilizavel`). Nenhum código mudou.
- 2026-10-23: **plano unificado** com a linha do colega, na branch `chore/plano-unificado`, criada a partir da `origin/feat/motor-linguagens` (`6493059`). A `chore/plano-produto` partia de antes da M, da L e da J, e dizia que Java e C# estavam fora. Mudanças:
  - o `PLANO-CHAOS.md` fica como plano do motor;
  - as etapas novas daqui trocaram de letra para não colidir com as do colega: Distribuição D→**G**, Licença L→**A**, Monetização M→**B**;
  - "Onde estamos", as decisões de linguagem, a C1 (testes já feitos), a F6 (Mongoose no mapa) e os combinados (push, cuidado com a máquina) foram atualizados;
  - **decidido:** a parte da empresa continua em TypeScript (ver "Decisões").

  Conferido nesta branch: `npm run check` com 400 testes passando e 4 pulados; `topology` no `pedidos-springboot` e no `pedidos-aspnet`. Nenhum código mudou.
- 2026-10-23: **S1** (branch `feat/separacao-api`). `apps/frontend/server` virou `apps/api/src` (`@shieldepy/api`: `start`, `dev`, `bootstrap`, `seed:demo`) e os testes foram para `apps/api/test`, sem mudar comportamento. A API serve o build em `apps/frontend/dist` (ou em `SHIELDEPY_STATIC_DIR`). O banco agora fica em `apps/api/data`, ainda no `.gitignore`, e o `SHIELDEPY_DATA_DIR` continua valendo. O `dev.mjs` sobe a API com `cwd` em `apps/api`. A demo (`scripts/demo/seed.ts`, `demo.mjs`) e o `.claude/launch.json` apontam para o lugar novo. `npm run check`: 404 passando. A API subiu com `npm start -w @shieldepy/api` e respondeu em `/api/account`. Falta conferir o `web:dev` no navegador e o device flow no VS Code (pedir antes).
  - **Decidido com o usuário:** DDD por domínio na `apps/api` (nova tarefa S7) e Postgres (P1 logo depois da S).
