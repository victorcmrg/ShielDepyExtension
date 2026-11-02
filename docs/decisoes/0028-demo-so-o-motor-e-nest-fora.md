# 0028 — A demo é o motor, com a empresa só simulada; o NestJS sai do MVP

**Data:** 2026-11-02 (escolha do usuário; responde a DP7) · **Estado:** valendo · **Ajusta:** a [0018](0018-mvp-caos-e-frameworks.md)

**Contexto.** A DP7 perguntava se a demo do TCC seria só o motor ou se teria o fluxo comercial mockado (compra → download → login → a extensão libera). A contribuição do TCC é o motor, e o fluxo comercial põe muita peça móvel ao vivo. A 0018 também punha o NestJS no critério de pronto, com a MVP5 estimada em 3 a 4 dias.

**Decisão.**
- **A demo segue o [`docs/roteiro-mvp.md`](../roteiro-mvp.md):** Express ao vivo na extensão, o mesmo em Fastify, a tabela da MVP8 em slide e o portal local com o histórico do caos.
- **Sem o fluxo de compra, de download e de liberação pelo login.** A extensão não trava nada atrás de conta.
- **A parte da empresa é simulada, mas funciona de verdade:** a página de plano, assinatura e faturas (MVP7) é uma tela real do portal, que abre e navega, com dados fixos e o selo "demonstração". Não há provedor de pagamento, formulário de cartão nem regra de cobrança.
- **O NestJS (MVP5) sai do critério de pronto do MVP.** Fica como tarefa opcional, para o usuário pedir depois. O mapa já lê as rotas dele; na demo, vale dizer "o mapa lê, o caos ainda não".

**Consequências.**
- O critério de pronto do MVP passa a ser em projetos Express e Fastify.
- A MVP7 fica destravada. O screenshot da página pede o Chrome (perguntar antes).
- A DP8 (o arnês de teste na extensão) continua aberta e não bloqueia esta demo: o Express roda pelo botão, e o Fastify, pela CLI.
