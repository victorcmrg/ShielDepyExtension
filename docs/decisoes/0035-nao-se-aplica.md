# 0035 — "Não se aplica" separa a falha que não disparou do teste inválido

**Data:** 2026-11-06 (teste do usuário na extensão) · **Estado:** valendo

**Contexto.** No `checkout-express-fixed`, o resultado esperado é "4 aguentou, 1 inválido": a correção reserva o estoque antes de cobrar, e não há gravação depois da API para a falha atingir. O código está certo, mas "inválido" soa como erro. A palavra juntava dois casos diferentes: o controle que falhou (o contrato ou o ambiente têm um problema) e a falha que não disparou (o controle passou, e o caminho testado não passa por ali).

**Decisão.**
- **Com o controle verde e a falha sem disparar, o texto é "não se aplica".** O motivo vai sempre ao lado ("a falha não disparou: nenhuma gravação em stock depois da chamada à API"), porque o motor só viu esta requisição: um outro caminho pode gravar.
- **O controle que falhou, o arquivo que não carregou e o teste que não rodou seguem "inválido".** Esses pedem uma ação de quem roda.
- **O dado continua `status: 'invalid'`, com `notApplicable: true` a mais.** O portão, o exit 2 quando nenhum teste valeu, o dataset e o portal não mudam: "não se aplica" não prova nada e nunca vira "aguentou".

**Consequências.**
- Terminal, relatório e mapa usam o texto novo. Um `chaos-results.json` antigo, sem o campo, segue mostrando "inválido" até rodar de novo.
- O portal segue dizendo "inválidos": a contagem é uma coluna do banco, e separar pede uma migration. Fica para quando a parte da empresa voltar.
