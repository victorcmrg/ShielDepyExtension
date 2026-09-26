# Plano de Correções do ShielDepy

Cada correção vem com um teste escrito **antes** do fix. O teste precisa **falhar** no código antigo (🔴) e **passar** depois da correção (🟢). Esse par vermelho→verde é a prova de que o fix funciona.

Ao final de cada etapa, este arquivo é atualizado com o resultado e o trabalho para para revisão.

## Método

1. Escrever o teste → `npm test` → confirmar que **falha** pelo motivo esperado.
2. Aplicar o fix mínimo → `npm test` → **passa**, e os testes anteriores continuam verdes.
3. `npm run compile` sem erros ao fim de cada etapa.
4. Registrar aqui o teste, a saída 🔴 e a saída 🟢.

---

## Etapa 0 — Infraestrutura de testes

- [x] Vitest + scripts `test` / `test:watch`
- [x] `vitest.config.ts` com alias de `vscode` → `test/mocks/vscode.ts`
- [x] Stub do `vscode` (`Uri`, `Range`, `Position`, `EventEmitter`, `Diagnostic`, `workspace`, `window`, `languages`)
- [x] Helper que cria um `GraphManager` real (com os `.wasm`) e fixtures em diretório temporário
- [x] Teste de fumaça: `a()` chama `b()` → aresta `a → calls → b`

## Etapa 1 — Grafo correto (núcleo da proposta)

- [x] 1.1 Resolução de imports (`./b` → `b.ts`, `/index.*`, `.js→.ts`)
- [x] 1.2 Arestas de entrada preservadas ao reparsear (HTML→CSS sobrevive à edição do CSS)
- [x] 1.3 Religar chamadas entre arquivos (independe da ordem de indexação e das linhas deslocadas)
- [x] 1.3b *(descoberto pelos testes)* Import escrito antes de o arquivo existir é ligado quando o arquivo é criado
- [x] 1.4 Chamada atribuída ao símbolo mais interno (método, não classe)
- [x] 1.5 Arrow functions e function expressions viram símbolos
- [x] 1.6 Detecção de ciclo iterativa (sem stack overflow) e **ciclo entre arquivos** detectado
  - Correção da análise inicial: a memoização `deadEnd` **é correta** (equivale ao `visited` de uma DFS de alcançabilidade), então foi mantida. O problema real era a recursão.

## Etapa 2 — Vazamentos e condições de corrida

- [ ] 2.1 `tree.delete()` em toda árvore do Tree-sitter (leak de memória WASM)
- [ ] 2.2 `detectCycles` compartilhado (remove as 3 cópias)
- [ ] 2.3 `verifyFix` roda num `fork()` do grafo, sem sobrescrever o grafo real
- [ ] 2.4 Sem análise duplicada (`runNow` + evento de abrir → 1 chamada paga)

## Etapa 3 — Custo, privacidade e segurança

- [ ] 3.1 `isAnalyzable`: só `scheme === 'file'` + linguagem suportada
- [ ] 3.2 Inline só em arquivos de código (nada de `.env` / plaintext)
- [ ] 3.3 Cancelamento real da requisição (`AbortSignal`)
- [ ] 3.4 `applyFix` restrito ao workspace (`resolveFixPath`)
- [ ] 3.5 CSP com nonce nos 3 webviews + `escapeHtml` em todos os campos
- [ ] 3.6 Histórico do chat limitado (`trimHistory`)
- [ ] 3.7 Limite de concorrência (máximo 2) nas varreduras de IA

## Etapa 4 — Correções menores

- [ ] 4.1 Debounce por documento
- [ ] 4.2 ID estável baseado no código, não na mensagem da IA
- [ ] 4.3 Poda do cache de achados
- [ ] 4.4 Remover o Enter que aceita o ghost text
- [ ] 4.5 README atualizado

## Etapa 5 — Qualidade estrutural (sem mudar comportamento)

- [ ] `config.ts` tipado e `constants.ts`
- [ ] Painel desacoplado do chat (comando `shieldepy.attachFinding`)
- [ ] `fixedFile.ts` compartilhado (com teste)
- [ ] HTML/CSS/JS dos webviews em `media/`
- [ ] Comentários enxutos

## Verificação ponta a ponta (ao final)

1. `npm install` → `npm test` → `npm run compile` → `npm run build`
2. F5 com `test/fixtures/manual/`:
   - Ciclo `a.ts ↔ b.ts` aparece no Problems
   - HTML/CSS com classe inexistente: o warning continua depois de editar o CSS
   - Diff do git não dispara análise
   - "Analisar Pasta Inteira": 1 varredura por arquivo
   - Botão "Aplicar" aparece só para arquivos do workspace

---

## Registro de evidências

### Etapa 0 — infraestrutura

- `test/etapa0-infra.test.ts`: 🟢 1/1. Roda o Tree-sitter real (os `.wasm` de `wasm/`), sem parser falso.

### Etapa 1 — grafo correto

Testes: `test/etapa1-resolveImport.test.ts` (11) e `test/etapa1-grafo.test.ts` (10).

**🔴 Antes do fix (código original):** 9 falhas, cada uma pelo motivo esperado:

| Teste | Falha observada |
|---|---|
| 1.1 import `./b` liga ao nó real | `expected false to be true` (a aresta aponta para um nó fantasma sem `.ts`) |
| 1.1 resolver (11 casos) | módulo `resolveImport` inexistente |
| 1.2 CSS reparseado mantém HTML→CSS | `expected [] to deeply equal ['.missing']` (o vínculo sumiu e a checagem fica muda) |
| 1.2 HTML indexado antes do CSS | `expected [] to deeply equal ['.nope']` |
| 1.3 chamador indexado antes do chamado | `expected false to be true` |
| 1.3 linhas deslocadas em b.ts | `expected false to be true` |
| 1.4 chamada no método | `expected false to be true` (a aresta saía da classe) |
| 1.5 arrow function | `símbolo "f" não encontrado no grafo` |
| 1.6 ciclo a.ts → b.ts → a.ts | `expected null not to be null` |
| 1.6 cadeia de 15.000 saltos | `RangeError: Maximum call stack size exceeded` |

Depois dos primeiros fixes, o teste do ciclo entre arquivos continuou 🔴. Isso revelou o item 1.3b: quando `a.ts` é indexado, `b.ts` ainda não existe e o import nunca era revisitado. O item foi corrigido, e o teste 1.3b foi adicionado explicitamente.

**🟢 Depois do fix:** `Test Files 3 passed (3) · Tests 22 passed (22)`; `npm run compile` sem erros; o build com esbuild funciona.

**Evidência em código real:** o próprio `src/` da extensão (14 arquivos) foi indexado com as duas versões do `GraphManager`:

| Métrica | Antes | Depois |
|---|---|---|
| Chamadas entre arquivos diferentes | **0** | **94** |
| Nós "fantasma" (import não resolvido) | 12 | **0** |
| Arestas `calls` no total | 66 | 227 |
| Símbolos (`defines`) | 130 | 143 (arrow functions) |
