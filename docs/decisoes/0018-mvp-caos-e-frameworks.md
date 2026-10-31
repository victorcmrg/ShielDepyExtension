# 0018 — MVP de demonstração: o caos utilizável nos frameworks, com a parte da empresa mockada

**Data:** 2026-10-31 (escolha do usuário) · **Estado:** valendo · **Adia:** a [0017](0017-lancamento-minimo.md) (lançamento mínimo) e as etapas A, B e P

**Contexto.** A [0017](0017-lancamento-minimo.md) punha o site, os marketplaces e o portal no ar logo depois da C2f. O usuário quer antes um MVP para mostrar: o caos funcionando de ponta a ponta em vários frameworks, com um passo a passo sólido, sem gastar tempo agora com licença, cobrança, segurança de produção ou organização da empresa.

**Decisão.**
- A próxima etapa é o **MVP**: terminar o caos utilizável (o resto da C2) e levá-lo, numa versão rápida, a mais frameworks (Fastify, NestJS, Koa/Hono, Next). Cada framework entra no mínimo que roda o caos (rotas, I/O, `createApp` e um exemplo com teste de aceitação), não no alcance completo da F.
- **A parte da empresa fica figurativa:** o portal roda local, com os dados de demonstração (`seed:demo`), e as telas de plano, assinatura e faturas usam dados fixos e dizem que são demonstração. Não há provedor de pagamento, regra de cobrança nem deploy. Como não há regra de negócio nelas, o TDD da [0011](0011-tdd-na-empresa.md) não se aplica a essas telas.
- O MVP termina com um roteiro (`docs/roteiro-mvp.md`) que qualquer pessoa segue: instalar a extensão pelo `.vsix` local, abrir um projeto, gerar o contrato, rodar o caos e ver o achado no código, no relatório e no portal.
- **Ficam paradas até depois do MVP:** o lançamento mínimo (degraus 1 e 2), a W, a G (exceto o `.vsix` local que já existe), a licença (A), a cobrança (B), a produção (P) e o caos no CI de verdade (C4). As decisões pendentes DP1 a DP5 deixam de bloquear o caminho.

**Consequências.**
- Nada muda no motor ("o motor prova, a IA propõe", sem regex para ler código) nem na fronteira produto × empresa ([0008](0008-produto-e-empresa.md)). A versão rápida de um framework ainda marca como `heuristic` o que não prova.
- A cobrança mockada não pode parecer real para quem vê a demo: as telas dizem "demonstração", e não há formulário de cartão.
- A etapa D (dados para o treino, [0016](0016-dados-para-treino.md)) não entra no caminho do MVP e continua independente.
