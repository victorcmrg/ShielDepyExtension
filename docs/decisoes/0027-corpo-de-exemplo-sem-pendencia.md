# 0027 — O corpo de exemplo do `--init` sai dos campos lidos, sem a marca de pendência

**Data:** 2026-10-31 (escolha técnica, na MVP6) · **Estado:** valendo

**Contexto.** O contrato gerado pelo `--init` saía com `body: {}` e uma pendência em cada rota com corpo: era a pendência que sobrava em todo projeto da C1. A MVP6 monta um corpo de exemplo a partir das propriedades que a cadeia de handlers lê de `req.body` (lidas pela AST: acesso direto, desestruturação, apelido), com valores pelo nome do campo. Falta decidir se a linha continua marcada como pendência.

**Decisão.**
- A linha sai **sem** o `TODO(shieldepy)`, com o comentário "corpo pelos campos que X lê (confira os valores)".
- O corpo não é prova de nada: um valor pelo nome pode não casar com os dados do banco (o `productId: '1'` contra um estoque `'p-1'`). Quem decide é o bloco de controle de cada teste gerado, que já existe: se a rota não aceita o corpo sem caos, o teste sai **inválido**, não achado, e o relatório diz "o controle (sem caos) falhou". Não há falso achado por causa de um corpo ruim.
- Sem nenhuma leitura de `req.body` na cadeia, a pendência continua como antes.
- Os valores pelo nome são texto escolhido sobre o nome do campo (que veio da AST), não leitura de código.

**Consequências.**
- Num `checkout-express` limpo, o `--init` caiu de 4 para 3 pendências, e o caos achou os 6 problemas com o corpo gerado, sem edição.
- A pendência "real" que sobra quando o valor não casa aparece como inválido no relatório, que já explica o motivo.
- Depois do MVP: o corpo pelo zod/joi, pelo tipo TS do `req.body` e pelo DTO do NestJS (C2b), e o que um serviço chamado com o `req.body` inteiro lê.
