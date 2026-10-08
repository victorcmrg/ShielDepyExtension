# ShielDepy — TCC

```
ShielDepyExtension/
├── PLANO-CHAOS.md   ← 🧭 plano em andamento (Chaos Engineering dirigida pelo grafo)
└── shieldepy_p1/    ← ✅ o sistema — é aqui que se trabalha
```

## ✅ Sistema: `shieldepy_p1/`

Um monorepo com núcleo compartilhado, extensão VS Code, CLI e frontend (landing + portal).
O grafo estrutural prova ciclos, o grafo de interações prova colisões, e a IA (Claude, Gemini ou
nenhuma) só explica o que foi provado. Ele nasceu da fusão de dois projetos anteriores (a extensão
original em grafo de árvore e o Grafo de Interações), que ficam só no histórico do git.

O [README do `shieldepy_p1`](shieldepy_p1/README.md) explica como o sistema funciona, onde fica
cada coisa e como rodar.

```bash
cd shieldepy_p1 && npm install && npm run check     # F5 abrindo a pasta shieldepy_p1
```

**Em andamento:** [`PLANO-CHAOS.md`](PLANO-CHAOS.md) descreve o pipeline em 4 etapas:
1. **E1**, concluída: o grafo mapeia o sistema inteiro e mostra a cobertura (`shieldepy graph`).
2. **E2**, em andamento: a topologia de rotas e I/O.
3. **E3:** agentes LangGraph que geram testes de caos para os pontos críticos.
4. **E4:** gate de CI que bloqueia o PR.

O progresso e as decisões de cada tarefa ficam registrados no próprio plano.

No VS Code, abra **a pasta `shieldepy_p1`** (não a raiz) para o F5 usar a configuração certa de `.vscode/`.
