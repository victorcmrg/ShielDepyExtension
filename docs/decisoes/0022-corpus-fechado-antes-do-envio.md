# 0022 — O corpus fecha do nosso lado antes de ir para a equipe de IA, e as chaves não serão trocadas

**Data:** 2026-11-03 · **Estado:** valendo · **Complementa:** [0020](0020-dataset-direto-no-neon.md)

**Contexto.** O plano esperava a equipe de IA trocar as chaves que vieram pelo chat (Neon, LangSmith e Hugging Face) e mandar uma URL nova antes de o corpus novo ser enviado. O usuário decidiu outra ordem (2026-11-03).

**Decisão.**
- **As chaves não serão trocadas.**
- **O nosso lado fecha primeiro.** O corpus é gerado e conferido localmente, sem a variável `SHIELDEPY_DATASET_DATABASE_URL`. O envio ao Neon e as informações para a equipe vão uma vez só, no fim, com autorização do usuário.

**Consequências.**
- Até o envio, o Neon fica com os 35 registros e os 19 pares de 2026-10-31.
- Quem tiver o histórico daquele chat continua com acesso ao banco e às outras contas. É um risco aceito pelo usuário.
