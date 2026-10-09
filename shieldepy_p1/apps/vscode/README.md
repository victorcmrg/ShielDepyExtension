# ShielDepy — Guardião de Arquitetura

O ShielDepy lê o seu projeto JavaScript/TypeScript, monta o **mapa do sistema** e **prova** problemas de arquitetura antes do commit: ciclos de chamada, colisões entre regras e rotas que quebram quando uma API ou o banco falham.

**O motor prova, a IA propõe.** Tudo o que aparece como achado foi provado pelo código ou por um teste. A IA é opcional.

## Instalação

Pelo arquivo `.vsix` (GitHub Releases):

1. Baixe o `shieldepy-<versão>.vsix` da página de releases.
2. No VS Code, abra **Extensions** (`Ctrl+Shift+X`), clique em **…** no topo e escolha **Install from VSIX…**.
3. Escolha o arquivo baixado.

Pelo terminal, o equivalente é `code --install-extension shieldepy-<versão>.vsix`.

Na primeira vez, os **Primeiros passos** abrem sozinhos. Para voltar a eles, use **ShielDepy: Primeiros Passos** na paleta de comandos.

## O que ele faz

### Achados provados, enquanto você digita
- **Ciclos de chamada** entre funções e arquivos.
- **Colisões:** dois lugares gravam o mesmo campo no mesmo evento, ou um lê o que o outro acabou de gravar.

Aparecem no **Problems**, no **Explorer** (■ importante, ▲ atenção, ● leve) e na **lista de erros** do ShielDepy. Não precisa de conta, de configuração nem de internet.

### Mapa do sistema
**ShielDepy: Ver Mapa do Sistema** mostra rota → controller → serviço → repositório → banco ou API externa, ligados pelo que o código prova. **Comparar Mapa com uma Branch** mostra o que a sua branch mudou na estrutura e quais rotas ela tocou.

### Teste de caos
**ShielDepy: Testar Caos** gera e roda testes que injetam falhas nas rotas sensíveis:
- timeout, 5xx ou corpo inválido de uma API externa;
- duas requisições ao mesmo tempo (corrida).

Um teste só conta como problema quando o **controle** (a mesma requisição, sem a falha) passou.

Na primeira vez, o ShielDepy cria o contrato `shieldepy.chaos.config.ts` a partir do mapa, já com as rotas e as APIs. Você completa só o que vier marcado com `TODO(shieldepy)`. O resultado aparece no mapa, e o relatório fica em `.shieldepy/chaos-report.md`.

**Alvo suportado hoje:** Express com `pg` ou Prisma, e `fetch` ou `axios` para APIs. Os testes usam o Vitest do projeto, com `supertest` e `msw`. Se faltar algum, o ShielDepy mostra o comando para instalar.

### IA (opcional)
Com uma chave da **Anthropic** ou do **Google Gemini** (**ShielDepy: Configurar Chave da IA**), a IA:
- explica os achados;
- conversa no **Chat do ShielDepy** com o contexto do mapa;
- propõe as hipóteses de caos.

A chave fica criptografada no Secret Storage do VS Code.

## Privacidade
- A análise, o mapa e o caos rodam **nesta máquina**.
- Só com a IA ligada, trechos de código e o recorte do mapa vão para o provedor da sua chave.
- O modo **offline** (`shieldepy.aiProvider`) nunca chama IA.

## Configurações principais
| Configuração | O que faz |
|---|---|
| `shieldepy.aiProvider` | `auto`, `anthropic`, `gemini` ou `offline` |
| `shieldepy.backgroundAnalysis.trigger` | analisar ao pausar a digitação ou só ao salvar |
| `shieldepy.display.minSeverity` | esconder os achados leves |
| `shieldepy.analysis.exclude` | globs ignorados (ex.: `**/*.test.ts`) |
| `shieldepy.index.maxFiles` | teto de arquivos do mapa (padrão 3000) |
| `shieldepy.language` | português, inglês, espanhol ou russo |

## Linguagens
O mapa completo (chamadas, imports, rotas) é de **JavaScript e TypeScript**. Java, Python e C# entram só nas colisões entre regras.
