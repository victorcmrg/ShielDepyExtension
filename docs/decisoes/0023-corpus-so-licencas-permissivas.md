# 0023 — No corpus, só código público com licença permissiva

**Data:** 2026-11-03 · **Estado:** valendo · **Complementa:** [0016](0016-dados-para-treino.md) · **Responde:** a parte de licenças da DP6

**Contexto.** Para ter variedade, o corpus passa a buscar projetos públicos no GitHub. O código desses projetos vai para o treino de um modelo, então a licença importa.

**Decisão.** Só entram projetos com licença MIT, Apache-2.0 ou BSD declarada no repositório. Projeto sem licença declarada fica de fora. A licença vai em `source.license`, e o projeto fica fixado por commit.

**Consequências.**
- Projetos com GPL, AGPL ou sem licença ficam de fora, mesmo que sejam bons para o caos.
- Os exemplos deste repositório são nossos e continuam no corpus sem licença declarada até a DP2.
- O resto da DP6 continua aberto: gerar também com a IA (pago) e com que orçamento.
