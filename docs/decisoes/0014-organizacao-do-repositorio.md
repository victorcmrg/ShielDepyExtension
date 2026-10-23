# 0014 — Monorepo na raiz, `main` como tronco, plano curto + decisões

**Data:** 2026-10-23 (pedido do usuário) · **Estado:** valendo

**Contexto.**
- A `main` estava parada desde 2026-10-16, com 14 commits só em branches empilhadas umas nas outras, e 17 branches no GitHub já contidas nessa linha. Com duas pessoas no repositório, isso gera conflito e dúvida sobre qual é a versão boa.
- O `PLANO-CHAOS.md` tinha 1.943 linhas: tinha virado um diário, caro de ler para retomar o trabalho.
- O código ficava em `shieldepy_p1/`, um nome de protótipo, e os planos e relatórios ficavam fora dele.

**Decisão.**
- **O monorepo é a raiz do repositório.** Saiu a pasta `shieldepy_p1/`. A documentação fica em `docs/`:
  - `como-funciona.md`: o antigo README interno;
  - `decisoes/`: estes arquivos;
  - `pesquisa/`: os relatórios datados;
  - `historico/`: o `PLANO-CHAOS.md` e o registro antigo, só para consulta.
- **A `main` é o tronco.** Cada etapa sai de uma branch nova a partir da `main` e volta para ela quando termina (PR ou merge, sempre pedido pelo usuário). Branch já mergeada é apagada.
- **O `PLANO.md` é curto:** onde estamos, as decisões pendentes, as etapas e as tarefas que faltam. Tarefa pronta ganha ✅ e sai do detalhe quando a etapa fecha.
- **O registro de cada tarefa é o commit** (e a descrição do PR). Decisão nova vira um arquivo em `docs/decisoes/`, no mesmo commit da mudança.

**Consequências.** Quem tem um clone antigo precisa rodar `npm install` na raiz depois de atualizar, porque os links dos workspaces mudam de lugar. Branches abertas antes da mudança precisam de merge com a `main`; o git acompanha os arquivos movidos.
