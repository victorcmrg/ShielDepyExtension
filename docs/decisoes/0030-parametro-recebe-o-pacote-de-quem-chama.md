# 0030 — Um parâmetro sem tipo vale o que quem chama passa a ele

**Data:** 2026-11-03 (escolha técnica, para o par real do `telemetry-tracker`) · **Estado:** valendo

**Contexto.** Um serviço que recebe o cliente do banco por parâmetro só era lido com o tipo simples (`prisma: PrismaClient`). A união (`PrismaClient | Prisma.TransactionClient`) e o parâmetro sem tipo davam zero operações, porque o receptor não dizia o pacote. O grafo trata cada chamada isoladamente, e o valor de um parâmetro depende de quem chama.

**Decisão.**
- **União:** vale quando todos os membros são do mesmo pacote; `null` e `undefined` não contam. Sem isso, nada muda: `A | Map` continua sem pacote.
- **Parâmetro sem tipo:** a topologia olha o que chega a ele (`topology/params.ts`), inclusive repassado por outras funções e capturado por um callback. O argumento diz o pacote do valor (`valuePackage`), pelo tipo local ou por quem produz o valor no topo do arquivo. Fica fora do `CodeGraph`, que continua sem reescrita: é uma passada só, depois da indexação.
- **Confiança:** sai `proven` só se toda chamada à função passa aquele valor. Com um chamador sem prova, `heuristic`. Com dois pacotes, não se escolhe.
- **Só pelo nome:** `prisma.x.create()` com `prisma` por parâmetro, num projeto que usa o `@prisma/client`, sem nenhum chamador que prove, sai `heuristic`. Outro nome (`db`) sem prova não vira operação.
- **Parâmetro de callback sem símbolo** (`items.map((item) => item.create())`) não é o da função de fora, mesmo no mesmo índice (`receiverInCallback`). Sem esse cuidado, o motor inventava operações provadas.
- Cada passada lê só a anterior, então a resposta não depende da ordem de indexação. O limite é de 16 saltos de repasse.

**Consequências.**
- Vale para qualquer pacote de I/O, não só o Prisma. No `proshop-v2` apareceu uma leitura verdadeira: `checkIfNewTransaction(Order, id)` recebe o modelo do Mongoose por parâmetro.
- O `tx` de `prisma.$transaction(async (tx) => ...)` continua de fora: é parâmetro de um callback sem símbolo.
- Um valor guardado num objeto (`{ prisma }`, `opts.prisma.x.create()`) também continua de fora.
