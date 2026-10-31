# 0020 — O dataset vai sozinho para o Neon da equipe de IA, só nas nossas máquinas

**Data:** 2026-10-31 · **Estado:** valendo · **Complementa:** [0016](0016-dados-para-treino.md)

**Contexto.** Na 0016, o dataset sai como arquivo (`shieldepy chaos --dataset`, `npm run dataset:gerar`) e a equipe de IA o importa no banco dela. O usuário quer menos passo manual (2026-10-31): rodar o caos (pela CLI ou pelo plugin) e os resultados chegarem sozinhos ao banco do treino. Ele escolheu o Neon da equipe como destino e "toda execução do chaos" como gatilho.

**Decisão.**
- **Com a variável `SHIELDEPY_DATASET_DATABASE_URL`** (a URL do Postgres da equipe), cada execução do `shieldepy chaos` com resultado de teste grava os registros na tabela `shieldepy_dataset` desse banco. Vale para a CLI e para o plugin, que roda o mesmo `runChaosCommand` com o `process.env`. A tabela é criada se não existir: `id` (chave), `schema_version`, `project`, `variant`, `hypothesis_id`, `outcome`, `control`, `record` (o registro inteiro, em `jsonb`), `created_at` e `updated_at`.
- **Upsert pelo `id`:** rodar de novo o mesmo projeto, no mesmo commit, atualiza a linha em vez de duplicar.
- **Sem a variável, nada vai para a rede**, e ela não tem valor padrão nem configuração na extensão. O registro leva o **código-fonte** das rotas. Por isso a variável só existe nas nossas máquinas (e, se um dia houver, no nosso CI), e o código de um cliente continua sem sair da máquina dele (0008, 0016).
- **Falha no envio só avisa.** O portão do caos (exit 0, 1 ou 2) não muda por causa do dataset, e o log mostra só o host, nunca a URL (ela tem a senha).
- **Os mutantes (D4)** rodam numa cópia, então o filho não envia: o `dataset:mutantes` tira a variável do ambiente dele e envia os registros já com a fonte do original.
- **A `apps/api` continua sem dataset** (0016): o banco da empresa, onde ficam os clientes, não se mistura com o do treino.

**Consequências.**
- A CLI declara o `pg`, e ele só carrega quando há para onde enviar. O `chaos.js` da extensão cresceu ~180 KB com ele (1,9 → 2,08 MB). O `extension.js` não muda.
- Os pares do DPO não vão para o banco: eles dependem do corpus inteiro, e a equipe pode montá-los com o `npm run dataset:pares` ou a partir da tabela.
- Ligar o envio na máquina de alguém é pôr a variável no ambiente dela. Quem tiver a variável manda o código de tudo em que rodar o caos: não use num projeto que não seja público ou nosso.
