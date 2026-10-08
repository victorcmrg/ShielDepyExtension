# ShielDepy — TCC

Este repositório tem **um sistema ativo** e **dois legados**. Cada um fica na sua pasta e é
independente dos outros (cada um tem o próprio `package.json`, `node_modules` e testes).

```
ShielDepyExtension/
├── PLANO-CHAOS.md                 ← 🧭 plano em andamento (Chaos Engineering dirigida pelo grafo)
├── shieldepy_p1/                  ← ✅ SISTEMA ATUAL — é aqui que se trabalha
├── legado_grafo_arvore/           ← 🗄️ LEGADO — extensão original (grafo em árvore)
└── legado_api_leitura_metadados/  ← 🗄️ LEGADO — Projeto18 (Grafo de Interações)
```

## ✅ Sistema atual: `shieldepy_p1/`

A **fusão dos dois legados**: um monorepo com núcleo compartilhado, extensão VS Code, CLI e web.
O grafo estrutural prova ciclos, o grafo de interações prova colisões, e a IA (Claude, Gemini ou
nenhuma) só explica o que foi provado.

Todo desenvolvimento novo, correção e entrega acontece aqui. O [README do `shieldepy_p1`](shieldepy_p1/README.md)
explica como o sistema funciona, onde fica cada coisa e como rodar.

```bash
cd shieldepy_p1 && npm install && npm run check     # F5 abrindo a pasta shieldepy_p1
```

**Em andamento:** [`PLANO-CHAOS.md`](PLANO-CHAOS.md) descreve o pipeline em 4 etapas:
1. **E1**, concluída: o grafo mapeia o sistema inteiro e mostra a cobertura (`shieldepy graph`).
2. **E2:** a topologia de rotas e I/O.
3. **E3:** agentes LangGraph que geram testes de caos para os pontos críticos.
4. **E4:** gate de CI que bloqueia o PR.

O progresso e as decisões de cada tarefa ficam registrados no próprio plano.

## 🗄️ Legados

> **Sistemas incompletos, mantidos só como referência histórica do TCC.**
> Não recebem correções nem funcionalidades novas. Tudo o que foi aproveitado deles já está
> no `shieldepy_p1/`, geralmente corrigido. Não use os legados como base para trabalho novo.

| Pasta | O que era | Por que é legado |
|---|---|---|
| [`legado_grafo_arvore/`](legado_grafo_arvore/) | Extensão VS Code original do ShielDepy. Monta o grafo estrutural do código (arquivos, funções, imports, chamadas) com Tree-sitter e usa o Claude para apontar riscos. | Só a etapa 1 do seu [`PLANO_DE_CORRECOES.md`](legado_grafo_arvore/PLANO_DE_CORRECOES.md) foi feita aqui. As etapas 2 a 5 (vazamento de memória, segurança dos webviews, custo de IA…) foram resolvidas no `shieldepy_p1`. Os achados vinham da IA, sem prova. |
| [`legado_api_leitura_metadados/`](legado_api_leitura_metadados/) | Projeto18 da equipe: o Grafo de Interações. Lê regras reativas (handlers, listeners, signals, triggers do Postgres), prova colisões entre elas e usa o Gemini para explicar. CLI e web. | Extratores só por regex; a web não validava entrada nem tinha limites; havia três registros de linguagem duplicados. O motor, os extratores e os exemplos foram portados e corrigidos no `shieldepy_p1`. |

Os legados ainda rodam, caso seja preciso comparar com a versão atual:

```bash
cd legado_grafo_arvore && npm install && npm test          # F5 abrindo a pasta legado_grafo_arvore
cd legado_api_leitura_metadados && npm install && npm test # npm run web para a interface
```

No VS Code, abra **a pasta do sistema** (não a raiz) para o F5 usar a configuração certa de `.vscode/`.
