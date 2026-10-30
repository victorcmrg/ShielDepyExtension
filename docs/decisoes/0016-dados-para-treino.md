# 0016 — Dados para treinar a IA de erros de produção: exportação pela CLI, rótulo do motor

**Data:** 2026-10-30 · **Estado:** valendo

**Contexto.** Outra equipe vai treinar um modelo aberto (Llama-3.2-1B-Instruct, com DPO) para ser especialista em erro de produção, com os dados que o ShielDepy gera. A proposta dela (2026-10-30) previa um projeto à parte (`shieldepy-poc`) com o `tree-sitter` nativo, o Neon com pgvector, o LangSmith e o Claude Sonnet como validador. Boa parte disso já existe no motor, e algumas peças contrariam as decisões 0001, 0002, 0006 e 0008.

**Decisão.**
- **O motor gera os dados; não há projeto paralelo.** A exportação é uma saída nova da CLI (`shieldepy chaos <pasta> --dataset <arq.jsonl>`), ao lado do `.shieldepy/chaos-results.json` que já existe. Formato JSONL versionado, um registro por hipótese testada.
- **O rótulo vem da execução, não de um LLM juiz.** "Vulnerável" é achado (o controle passou e o caos falhou); "aguentou" e "inválido" vão com esse status. Um registro só serve de exemplo positivo ou negativo se o controle passou (0001). O Sonnet não valida nada: quem valida é o Vitest.
- **Só código público ou nosso.** Os dados saem dos `examples/` e dos projetos reais do `mapa:reais` (fixados por commit, com a licença do repositório no registro). **Nada do que o CI de um cliente publica entra no treino:** o upload para o portal só leva fatos, sem código (0008), e isso não muda.
- **O banco do treino não é o da empresa.** A `apps/api` não ganha pgvector, tabela de dataset nem rota para isso. A outra equipe importa o JSONL no banco dela (o Neon que ela já tem).
- **O LangSmith é opcional e só na geração.** O LangGraph.js já envia os traços quando as variáveis `LANGCHAIN_*` existem; isso vale só na máquina que gera o dataset, nunca por padrão na extensão (manda a superfície de ataque para um terceiro).
- **O Tree-sitter continua o `web-tree-sitter` (WASM)**, não o pacote nativo `tree-sitter`: o nativo precisa compilar e quebra na extensão do VS Code e no Windows.

**Consequências.**
- O par para o DPO sai do próprio motor, sem rótulo humano: o mesmo teste dando achado no código vulnerável e "aguentou" na versão corrigida (como `checkout-express` × `checkout-express-fixed`). Os pares são poucos; a fatia de mutantes (D4 no plano) cria mais a partir de código corrigido.
- Gerar com o motor offline é grátis. Gerar com a IA (hipóteses e specs escritas pelo Claude) é chamada paga e só roda com autorização (0006).
- Um modelo treinado com isso, se um dia entrar no produto, é mais um provedor: a saída dele passa pela mesma validação do motor.
