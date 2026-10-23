# Arquivos para testar as colisões

Da raiz do repositório:

```bash
npm run cli -- report examples/para-testar
```

Ou abra esta pasta no VS Code com a extensão (F5 na raiz) e converse com o shieldPy no chat sobre os achados.
O site não analisa mais código: o motor roda só na máquina, pela extensão ou pela CLI (decisão 0008).

> O "serviço" de cada regra vem do **nome do arquivo**. O recurso e o evento vêm
> do próprio código (o evento que a regra escuta). Por isso os arquivos são
> autocontidos — não precisa de estrutura de pastas.

## Cenário 1 — Node / microsserviços (os 4 `.ts`)

`desconto.ts` · `imposto.ts` · `auditoria.ts` · `frete.ts`

Todos reagem a `pedido.atualizado`. O que o motor deve provar (**3 colisões**):

| Tipo | Campo | Quem briga | Severidade |
|------|-------|-----------|-----------|
| **write-write** | `total` | `desconto` vs `imposto` (os dois escrevem o total) | 🔴 Crítico |
| **read-after-write** | `total` | `auditoria` lê × `desconto` escreve — ordem `unknown` | 🟠 Alto |
| **read-after-write** | `total` | `auditoria` lê × `imposto` escreve — ordem `unknown` | 🟠 Alto |

`frete.ts` é o **controle saudável**: reage ao mesmo evento mas escreve um campo
exclusivo (`valorFrete`), então **não** aparece em nenhuma colisão — prova que o
motor não gera falso-positivo.

**No chat da extensão, teste a ancoragem (anti-alucinação):**
- "Por que `desconto` e `imposto` brigam?" → deve explicar a colisão real.
- "E o `frete`, também briga?" → deve dizer que **não** há colisão nele.
- "Existe alguma colisão no campo `cpf`?" → deve **recusar inventar** (nenhuma foi provada).

## Cenário 2 — Java / Spring (os 2 `.java`)

`PrecoListener.java` · `ImpostoListener.java`

Os dois escutam `PedidoAtualizado` e escrevem `total` → **1 colisão write-write**
(🔴 Crítico). Mesmo motor, outra linguagem: prova que a detecção é agnóstica.

> Os dois cenários são "ilhas" independentes (Node ≠ Java no mapeamento de
> evento). Com a pasta inteira, o `report` mostra as **4 colisões** somadas (3 do
> Node + 1 do Java), sem cruzamento entre linguagens — que é o esperado.
