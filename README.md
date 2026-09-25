# ShielDepy — Guardião de Arquitetura

Extensão de VS Code que mantém um **grafo em memória** do workspace (arquivos, funções/classes,
imports, chamadas) via Tree-sitter, e usa esse grafo — nunca o texto bruto do projeto inteiro —
como contexto para o Claude. Duas superfícies:

1. **Sugestão inline (ghost text)**, estilo Copilot, gerada com Haiku (rápido/barato) enquanto você digita.
2. **Comando "ShielDepy: Revisar Impacto no Grafo"**, que envia o arquivo alterado + seu subgrafo de
   impacto (vizinhança de profundidade 2) para uma revisão arquitetural completa, com 5 testes obrigatórios.
3. **Análise automática em background**: toda edição (digitar, colar, ou mudança programática), depois de
   um idle, reparseia o grafo, checa ciclos de chamada de graça e manda uma varredura leve pro Haiku — os
   riscos aparecem como marca-texto colorido (vermelho/amarelo/verde) com hover, no painel Problems, e em
   tempo real na lista da sidebar do plugin.

## Setup

```bash
npm install
```

Isso já baixa e copia sozinho os três `.wasm` do Tree-sitter para `wasm/` (via `postinstall` →
`scripts/copy-wasm.js`, usando o pacote `tree-sitter-wasms`) — não precisa baixar nada manualmente.
Se por algum motivo o `wasm/` ficar vazio (ex: rodou `npm install` antes dessa mudança), rode:

```bash
node scripts/copy-wasm.js
```

### 1. Chave da API Anthropic

Defina a variável de ambiente `ANTHROPIC_API_KEY`, ou configure `shieldepy.anthropicApiKey` nas settings
do VS Code (menos recomendado — evite comitar a chave).

### 2. Rodar em modo de desenvolvimento

```bash
npm run watch
```

Depois pressione `F5` no VS Code para abrir uma janela de Extension Development Host com a extensão carregada.

## Decisões de arquitetura

- **Grafo, não texto**: cada save/edição reparseia só o arquivo tocado; nós antigos daquele arquivo são
  descartados e recriados. O contexto enviado ao Claude é sempre um subgrafo (vizinhança), nunca o repo inteiro.
- **Dois modelos, dois SLAs**: `shieldepy.fastModel` (sugestão inline, poucos tokens, sem os 5 testes) e
  `shieldepy.deepModel` (revisão de impacto, mais tokens, formato de saída estruturado). Ambos usam Haiku por
  padrão — troque via settings se quiser mais qualidade ao custo de latência/preço.
- **Ghost text nativo**: o `InlineSuggestionProvider` usa a API `InlineCompletionItemProvider` do próprio
  VS Code — o "texto sombra" na frente do cursor, o cancelamento ao mover o cursor/clicar fora, e a aceitação
  são todos comportamento nativo do editor. `Tab` aceita por padrão; a keybinding em `package.json` também liga
  `Enter` à aceitação quando uma sugestão está visível (`inlineSuggestionVisible`).
- **Cancelamento de requisições obsoletas**: cada chamada inline tem um `requestId` incremental — se o usuário
  digitar de novo antes da resposta chegar, a resposta antiga é descartada silenciosamente.
