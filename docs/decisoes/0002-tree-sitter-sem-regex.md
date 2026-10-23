# 0002 — Código só se lê com Tree-sitter, nunca com regex

**Data:** 2026-10-07 · **Estado:** valendo

**Contexto.** Regex sobre código erra com comentários, strings, aninhamento e formatação, e o mapa precisa ser prova.

**Decisão.** Para ler código, só Tree-sitter ou analisador léxico. Regex continua permitido em texto da IA, em caminho de arquivo e em texto de runtime (logs, mensagens).

**Consequências.** Cada linguagem nova entra pela gramática do Tree-sitter (`packages/extractors`). Os testes que leem código (como o teste de fronteira da S4) usam a AST do TypeScript.
