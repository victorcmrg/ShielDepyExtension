# ShielDepy P1

ShielDepy é uma extensão do VS Code, com CLI e página web, que encontra **bugs de arquitetura
antes do commit**. Ela acha principalmente dois tipos de problema que ninguém "escreveu" sozinho:
eles só aparecem quando dois trechos de código, cada um correto isolado, se encontram.

- **Ciclos de chamada**: `a()` chama `b()`, que chama `a()` de volta, às vezes passando por
  vários arquivos. Resultado: loop infinito ou efeito cascata.
- **Colisões entre regras reativas**: dois handlers do mesmo evento mexem no mesmo campo.
  O preço aplica desconto em `total`, o imposto também reescreve `total`, e a auditoria lê
  `total` sem saber qual dos dois rodou primeiro.

Esses problemas são **provados** por um motor determinístico, sem IA. A IA (Claude ou Gemini),
quando configurada, só **explica** os fatos provados, conversa sobre eles e sugere correções.
Sem chave de IA, tudo o que foi provado continua funcionando.

Este repositório é a fusão de dois projetos do TCC:
**ShielDepy** (extensão, grafo estrutural via Tree-sitter) e **Projeto18 / Grafo de Interações**
(motor que prova colisões).

---

## Como o sistema funciona

### Os dois grafos

O sistema mantém dois grafos em memória, construídos a partir do mesmo código:

| | Grafo estrutural | Grafo de interações |
|---|---|---|
| **Pergunta que responde** | Quem importa e quem chama quem? | Quem lê e quem escreve qual campo, em qual evento? |
| **Nós** | arquivos, funções, métodos, classes, seletores CSS | regras reativas (um handler, listener, signal ou trigger) |
| **Como é lido** | Tree-sitter (a árvore sintática real do TS/JS), regex no HTML/CSS | Tree-sitter no TS/JS; regex no Java, Python, C# e PL/pgSQL |
| **O que prova** | ciclos de chamada; classe do HTML sem CSS correspondente | colisões write-write e read-after-write |
| **Onde vive** | `packages/core/src/code-graph/` | `packages/core/src/interactions/` |

Um exemplo do que vira regra:

```ts
bus.on('order.updated', (order) => {
  order.total = order.subtotal * 1.1;   // escreve total, lê subtotal
});
```

vira `{ resource: 'order', event: 'order.updated', reads: ['subtotal'], writes: ['total'] }`.

O motor agrupa as regras por **recurso × evento** (o "balde"). Dentro de cada balde, compara
as regras duas a duas:

- **write-write**: duas regras escrevem o mesmo campo. Ganha quem gravar por último → **Crítico**.
- **read-after-write**: uma lê o que a outra escreve. A gravidade depende da ordem:
  - ordem desconhecida (microsserviços, listeners) → valor imprevisível → **Alto**
  - quem lê roda antes → sempre lê o valor velho → **Médio**
  - quem lê roda depois → correto hoje, mas frágil → **Baixo**

### O que acontece na extensão, passo a passo

```
 abrir o workspace
   └─ indexa todos os arquivos (sem IA) ──► grafo estrutural + regras + colisões
                                                   │
 editar / salvar / abrir um arquivo                ▼
   └─ BackgroundAnalyzer (depois de ~1,2 s parado)
        1. reindexa só aquele arquivo (1 parse alimenta os dois grafos)
        2. achados GRÁTIS: ciclos, HTML→CSS quebrado        (origem "grafo")
        3. se há IA: varre só o trecho que mudou, recebendo
           os fatos já provados pra não repeti-los             (origem "ia")
   └─ CollisionPublisher (quando QUALQUER regra do workspace muda)
        recalcula as colisões e publica nos DOIS arquivos    (origem "colisao")
                                                   │
                                                   ▼
 FindingsManager ──► painel Problems (com link pra outra ponta da colisão)
                 ──► marca-texto colorido + hover no editor
                 ──► lista "Problemas encontrados" na barra lateral
                 ──► #id estável, citável no chat
```

No **chat** você pergunta sobre um achado, citando o `#id` ou usando "Ask AI" na lista. Se pedir
uma correção, a IA propõe o arquivo inteiro corrigido. **Antes de mostrar o botão "Aplicar"**, a
extensão testa a proposta numa cópia do grafo e confere se ela cria um ciclo ou uma colisão nova.
Se criar, pede à IA uma segunda tentativa. O botão só escreve dentro do workspace.

### O papel da IA (e o limite dela)

- A IA **nunca descobre** colisões nem ciclos: ela recebe os fatos provados e os explica.
- Toda explicação carrega o fato original. A IA não consegue trocar qual colisão está descrevendo.
- Se a IA declarar confiança abaixo de 85%, o status vira **"Requer Revisão Humana"**.
- Se a IA falhar ou responder fora do formato, o **explicador offline** assume, com o mesmo formato.
- A varredura da IA ainda aponta riscos que o motor não modela (race condition, promise sem
  `catch`, listener sem cleanup). Esses achados ficam marcados como origem **`ia`**.

---

## Mapa do código

As dependências andam numa direção só:

```
apps/vscode   apps/cli   apps/web        ← interfaces (só aqui existe `vscode`, http, argv)
      └───────────┼───────────┘
                  ▼
      packages/agent   packages/extractors   ← IA plugável · tradutores código → regras
                  └───────┬────────┘
                          ▼
                    packages/core           ← motor puro: sem vscode, sem rede
```

| Quero mudar… | Onde fica |
|---|---|
| Como uma colisão é detectada | `packages/core/src/interactions/detector.ts` |
| O formato de uma regra (`Rule`, `Collision`) | `packages/core/src/interactions/model.ts` |
| Como o grafo de imports e chamadas é mantido | `packages/core/src/code-graph/CodeGraph.ts` |
| O que é lido de um arquivo TS/JS (funções, imports, chamadas) | `packages/core/src/code-graph/extract-ts.ts` |
| O que é lido de HTML/CSS | `packages/core/src/code-graph/extract-web.ts` |
| Como um handler TS/JS vira regra | `packages/extractors/src/treesitter/event-handlers.ts` |
| Suporte a Java / Python / C# / Postgres | `packages/extractors/src/regex/*` |
| Qual extrator atende qual extensão de arquivo | `packages/extractors/src/registry.ts` |
| Claude ou Gemini (chamada HTTP, modelo, retry) | `packages/agent/src/providers/*` |
| Texto dos prompts | `packages/agent/src/code/prompts.ts`, `packages/agent/src/collisions/prompt.ts` |
| Explicação sem IA | `packages/agent/src/collisions/offline.ts` |
| Quando a extensão analisa um arquivo | `apps/vscode/src/analysis/BackgroundAnalyzer.ts` |
| Como os achados aparecem no editor | `apps/vscode/src/analysis/FindingsManager.ts` |
| O estado do workspace (grafo + regras + colisões) | `apps/vscode/src/workspace/WorkspaceModel.ts` |
| Chat, painel, configurações (lado da extensão) | `apps/vscode/src/chat/`, `apps/vscode/src/views/` |
| Chat, painel, configurações (HTML/CSS/JS da tela) | `apps/vscode/media/webview/` |
| Comandos da paleta | `apps/vscode/src/commands.ts` (registro em `extension.ts`) |
| Nomes de settings e comandos | `apps/vscode/src/config.ts`, `apps/vscode/src/constants.ts` |

### Convenções

- **Nomes de arquivo**: `PascalCase.ts` quando o arquivo exporta uma classe (`CodeGraph.ts`,
  `FindingsManager.ts`); `kebab-case.ts` para o resto (`extract-ts.ts`, `path-guard.ts`).
- **Idioma**: identificadores em inglês; comentários, mensagens e textos da interface em português.
- **Comentários** explicam o **porquê** (a decisão, o bug que evitam), não o que a linha faz.
- **Módulos puros primeiro**: o que dá para escrever sem `vscode`, rede ou disco fica fora dos
  apps e é testado direto (`WorkspaceModel`, `verify-fix`, `excerpt`, `FindingsCache`).
- **Linhas são 0-based** em todo o código; o +1 só acontece na hora de mostrar para humanos.
- **Um arquivo = uma responsabilidade**: o maior é o `CodeGraph.ts` (~500 linhas), a manutenção
  incremental do grafo, que não se divide bem.

### Como estender

**Nova linguagem** (ex.: Go): crie `packages/extractors/src/regex/go.ts` exportando
`(source) => ParsedRule[]`, registre em `registry.ts` e adicione uma pasta em `examples/` com as
mesmas colisões plantadas do sistema de pedidos. O teste de cenário
(`packages/extractors/test/scenarios.test.ts`) já cobre a nova stack se você acrescentar uma linha.
Na extensão, inclua o `languageId` em `apps/vscode/src/constants.ts`.

**Nova IA**: implemente `LLMProvider` (um método `complete`) em `packages/agent/src/providers/` e
inclua na escolha em `packages/agent/src/select.ts`.

---

## Rodar e testar

```bash
npm install
npm run check                 # typecheck + testes unitários/integração (vitest)
npm run build:vscode          # gera apps/vscode/dist e copia os .wasm
npm run test:e2e -w shieldepy # abre um VS Code DE VERDADE e testa a extensão ponta a ponta
```

**Extensão**: abra esta pasta no VS Code e aperte **F5**. Abre uma janela nova com `examples/`.
Em `pedidos-microservices/services`, `pricing` e `tax` devem ficar marcados em vermelho
(write-write em `total`) e `audit` em amarelo. Para ligar a IA: **ShielDepy: Configurar Chave da IA**.

**CLI** (`npm run cli -- <comando>`):

```bash
npm run cli -- report  examples/pedidos-spring/services        # só o motor
npm run cli -- explain fixtures/postgres-example.json          # motor + IA (ou offline)
npm run cli -- report  <pasta> --fail-on critico               # portão de CI: sai com 1
npm run cli -- cycles  <pasta>                                 # ciclos de chamada
npm run cli -- report  --pg postgres://user:pass@host/db       # triggers de um Postgres real
```

**Web**: `npm run web` → http://localhost:3000.

Chaves para a CLI e a web: copie `.env.example` para `.env`.

### O que os testes cobrem

- **157 testes** (vitest), cobrindo:
  - o motor
  - todos os extratores, incluindo os 4 stacks de exemplo
  - a IA com provedores falsos (sem rede)
  - o modelo do workspace, a verificação de correções e o cache
  - a CLI e o servidor web (HTTP de verdade)
- **E2E da extensão** (`test-e2e/`): num VS Code real, confere que a extensão:
  - ativa e registra os comandos
  - mostra as colisões nas duas pontas e não acusa o controle
  - acha o ciclo
  - desfaz a colisão ao vivo quando o código é editado
  - gera o relatório offline

---

## Histórico: o que mudou em relação aos projetos originais

Itens do `PLANO_DE_CORRECOES.md` da extensão original (`legado_grafo_arvore/` no repositório do TCC) resolvidos durante a fusão:

| Item | Como ficou |
|---|---|
| 2.1 vazamento de `Tree` | `tree.delete()` em todo parse (`TsParser.withTree`) |
| 2.2 ciclo copiado 3× | `CodeGraph.cyclesInFile` / `allCycles` |
| 2.3 verifyFix no grafo real | `WorkspaceModel.fork()`: a simulação roda numa cópia |
| 2.4 análise duplicada | só o analyzer reindexa; a mesma versão do documento não é reanalisada |
| 3.1 diff/virtual disparando IA | `isAnalyzable`: só `file:`, fora de node_modules, até 2 MB |
| 3.2 inline em `**` | só linguagens de código, `scheme: file` |
| 3.3 cancelamento | `AbortSignal` até o HTTP (Anthropic e Gemini) |
| 3.4 applyFix fora do workspace | `resolveInsideWorkspace`; o conteúdo do fix não passa pelo webview |
| 3.5 webview sem CSP | CSP com nonce, assets em `media/webview`, só `textContent` |
| 3.6 histórico sem limite | `trimHistory` (turnos + caracteres) |
| 3.7 concorrência | no máximo 2 chamadas de IA simultâneas |
| 4.1 debounce global | debounce por arquivo |
| 4.2 id baseado na frase da IA | `Finding.key` (ancorado na linha de código) |
| 4.3 cache sem poda | resolvidos há mais de 30 dias saem; teto de 5000 |
| 4.4 Enter aceita ghost text | keybinding removido |
| 5.1–5.4 estrutura | `config.ts`/`constants.ts`, comando `attachFinding`, `parseFixedFile` único, `media/` |

Do Projeto18:
- validação de `Rule[]`
- allowlist de exemplos na web (o navegador não abre mais conexão com banco)
- JSON inválido → 400, não 500
- sessões com expiração e limite, rate limit
- registro único de linguagens
- duplicação `node-events`/`shared` removida
- Python aceita outro nome para a instância; C# escapa o tipo do evento

## Limites conhecidos

- Java, Python, C# e Postgres ainda são lidos por regex; só TS/JS usa a árvore sintática.
- `condition` das regras não é avaliada: regras que nunca rodam juntas ainda aparecem como colisão.
- Chamadas são ligadas por nome, dentro do arquivo e dos imports diretos. Import com alias,
  namespace e `require` dinâmico ainda não são entendidos.
- O painel, o chat e as configurações são testados no E2E só indiretamente (via comandos e
  Diagnostics), não clicando na interface.
