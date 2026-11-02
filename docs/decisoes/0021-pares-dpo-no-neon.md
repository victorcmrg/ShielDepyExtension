# 0021 — Os pares do DPO vão para o Neon, no formato aprovado pela equipe de treino

**Data:** 2026-11-02 · **Estado:** valendo · **Complementa:** [0016](0016-dados-para-treino.md) e [0020](0020-dataset-direto-no-neon.md) (a 0020 dizia que os pares não iam para o banco)

**Contexto.** A equipe de treino aprovou o formato `{ id, kind, prompt, chosen, rejected, provenance }` e pediu: o `prompt` em formato de instrução para o Llama-3.2-1B-Instruct, só o recorte da rota, nenhum registro inválido, e os pares direto no Neon, na tabela `shieldepy_dpo_pairs`, de onde o pipeline dela (Unsloth) os lê.

**Decisão.**
- **`npm run dataset:pares`** lê os registros de `shieldepy_dataset` (ou de `--in <arquivo>`) e grava os pares em `shieldepy_dpo_pairs` por upsert no `id`, quando a variável `SHIELDEPY_DATASET_DATABASE_URL` existe. O `chaos` não grava pares: eles dependem do conjunto inteiro.
- **`kind`** é `correcao` ou `diagnostico`, sem acento, como no pedido. O `prompt` segue os dois templates da equipe. Os pares de diagnóstico continuam com `provenance.weak: true`.
- **`provenance`** ganha o repositório, a licença (quando declarada) e os commits.
- **Os pares saem de um registro por conteúdo** (`uniqueDatasetRecords`). Linhas com o `id` antigo, que dependia do commit, têm o mesmo conteúdo das novas e multiplicariam os pares: no primeiro envio, saíram 100 em vez de 19.

**Consequências.**
- Rodar o `dataset:pares` de novo não duplica, com ou sem as linhas antigas na tabela.
- Um par só é regravado, nunca apagado: se o código de um exemplo mudar, os pares da versão anterior ficam na tabela, com o commit dela.
