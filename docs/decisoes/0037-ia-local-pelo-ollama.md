# 0037 — A IA local entra pelo Ollama, como mais um provedor, e só quando escolhida

**Data:** 2026-11-10 (pedido do usuário; escolhas técnicas nossas) · **Estado:** valendo · **Complementa:** [0001](0001-motor-prova-ia-propoe.md) e [0016](0016-dados-para-treino.md)

**Contexto.** A equipe de IA mandou o primeiro GGUF (`Llama-3.2-1B-Instruct.Q4_K_M.gguf`, Q4_K_M, 1,2B, `general.name = Modelo_Shieldepy`, feito no Unsloth) e quer que a extensão use o modelo treinado, offline e sem custo de API. Este primeiro arquivo é **de teste**: a equipe o treinou com dados simulados, para ver se cabe na GPU e se o formato bate com o Ollama. A extensão só falava com Anthropic e Gemini.

**Decisão.**
- **Um provedor `ollama`** em `packages/agent/src/providers/ollama.ts`, do mesmo jeito que o Gemini: `fetch` nativo em `POST /api/chat`, sem SDK nem chave. O `json` vira `format: "json"`, e o `maxTokens` vira `num_predict`.
- **Só quando escolhido.** Na extensão, `shieldepy.aiProvider: "ollama"` (com `shieldepy.ollamaModel`, padrão `shieldepy`, e `shieldepy.ollamaUrl`); na CLI, `SHIELDEPY_AI=ollama` com `OLLAMA_MODEL` e `OLLAMA_HOST`, os nomes do próprio Ollama. O `auto` não tenta o Ollama: sem o app aberto, toda chamada viraria erro.
- **Custo zero, com os tokens.** O modelo sai como `ollama:<nome>` no `Completion`, e o `CostMeter` dá preço zero a esse prefixo, em vez de "sem preço".
- **Nada muda na validação.** A saída do modelo local passa pelos mesmos validadores e fallbacks que a das outras IAs (0001). Um modelo de 1B que erra o JSON faz o caso de uso cair no caminho offline, como já acontece com qualquer IA.
- **O GGUF fica fora do git** (`*.gguf` no `.gitignore`). O `ia-local/Modelfile` importa o arquivo no Ollama (`ollama create shieldepy -f Modelfile`) com a amostragem que o próprio GGUF sugere (temperatura 0,6, top_p 0,9) e 16k de contexto: o maior prompt de correção tem cerca de 36 KB.

**Consequências.**
- Trocar pelo GGUF definitivo é rodar o `ollama create` de novo, com o mesmo nome: a extensão não muda.
- O modelo foi treinado para os dois prompts do DPO (correção e diagnóstico). Os outros usos da extensão (hipóteses do caos em JSON, chat, sugestão inline) têm outros prompts; ali ele pode render pouco, e o motor recusa o que não valida.
- O que o GGUF de teste fez nos 40 pares está no `PLANO.md` (2026-11-10).
