# Decisões

Uma decisão por arquivo: o contexto, o que foi decidido e o que isso obriga. Para mudar uma decisão, não reescreva o arquivo antigo. Escreva um novo que diga qual decisão ele substitui e marque o antigo como **Substituída por NNNN**.

| # | Decisão | Data | Estado |
|---|---|---|---|
| [0001](0001-motor-prova-ia-propoe.md) | O motor prova, a IA propõe | 2026-10-07 | valendo |
| [0002](0002-tree-sitter-sem-regex.md) | Código só se lê com Tree-sitter, nunca com regex | 2026-10-07 | valendo |
| [0003](0003-mapa-honesto.md) | Ligação sem prova sai como `heuristic`; o mapa não depende da ordem | 2026-10-07 | valendo |
| [0004](0004-caos-langgraph-vitest.md) | Caos: LangGraph.js em TS, testes em Vitest, controle sem caos | 2026-10-07 | valendo |
| [0005](0005-modo-local-gratis.md) | Modo local grátis: sem conta, tudo o que é determinístico funciona | 2026-10-09 | valendo |
| [0006](0006-ia-byok.md) | IA com a chave do próprio usuário (BYOK) | 2026-10-09 | valendo |
| [0007](0007-linguagens.md) | Linguagens: C# e Java no motor, Python a seguir, motor próprio | 2026-10-16 | valendo (substitui "só JS/TS", de 2026-10-09) |
| [0008](0008-produto-e-empresa.md) | Produto e empresa separados no mesmo monorepo; a API não importa o motor | 2026-10-23 | valendo |
| [0009](0009-modelo-de-venda.md) | Assinatura por empresa; a licença é um direito da conta | 2026-10-23 | valendo |
| [0010](0010-empresa-em-typescript.md) | A parte da empresa continua em TypeScript | 2026-10-23 | valendo |
| [0011](0011-tdd-na-empresa.md) | TDD em toda regra de negócio da empresa | 2026-10-23 | valendo |
| [0012](0012-postgres.md) | Postgres com migrations; PGlite nos testes | 2026-10-23 | valendo; o "sem ORM" foi substituído pela 0015 |
| [0015](0015-drizzle.md) | Drizzle para o esquema, as consultas e as migrations (não Alembic, não Prisma) | 2026-10-23 | valendo |
| [0013](0013-api-ddd-por-dominio.md) | `apps/api` em DDD, organizada por domínio | 2026-10-23 | valendo |
| [0014](0014-organizacao-do-repositorio.md) | Monorepo na raiz, `main` como tronco, plano curto + decisões | 2026-10-23 | valendo |
| [0016](0016-dados-para-treino.md) | Dados para treinar a IA de erros de produção: JSONL pela CLI, rótulo do motor, sem código de cliente | 2026-10-30 | valendo |
| [0017](0017-lancamento-minimo.md) | Da empresa, só o necessário para distribuir o produto (degrau 1: site estático + marketplaces; degrau 2: portal no ar) | 2026-10-30 | adiada pela 0018 |
| [0018](0018-mvp-caos-e-frameworks.md) | MVP de demonstração: o caos utilizável nos frameworks, com a parte da empresa mockada | 2026-10-31 | valendo |
| [0019](0019-banco-de-teste-prisma-pelo-socket.md) | No Prisma, o banco de teste do caos é o PGlite pela rede (`pglite-socket`), com uma conexão só | 2026-10-25 (portada em 2026-10-31) | valendo |
| [0020](0020-dataset-direto-no-neon.md) | O dataset vai sozinho para o Neon da equipe de IA a cada `chaos`, só com a variável que só nós temos | 2026-10-31 | valendo |
| [0021](0021-pares-dpo-no-neon.md) | Os pares do DPO vão para o Neon (`shieldepy_dpo_pairs`), no formato aprovado pela equipe de treino | 2026-11-02 | valendo |
| [0022](0022-corpus-fechado-antes-do-envio.md) | O corpus fecha do nosso lado antes de ir para a equipe de IA, num envio só no fim; as chaves não serão trocadas | 2026-11-03 | valendo |
| [0023](0023-corpus-so-licencas-permissivas.md) | No corpus, só código público com licença MIT, Apache-2.0 ou BSD declarada | 2026-11-03 | valendo |
| [0025](0025-arnes-de-teste-embutido.md) | O arnês de teste do caos (Vitest, supertest, MSW, PGlite) vem da CLI, emprestado por links, sem instalar nada no projeto | 2026-10-31 | valendo |
| [0026](0026-fastify-createapp-pelo-handler.md) | No Fastify, o `createApp` do contrato devolve um handler que espera o `ready()` (`app.routing`); os templates não mudam | 2026-10-31 | valendo |
| [0027](0027-corpo-de-exemplo-sem-pendencia.md) | O corpo de exemplo do `--init` sai dos campos lidos de `req.body`, sem a marca de pendência (o controle valida) | 2026-10-31 | valendo |
| [0028](0028-demo-so-o-motor-e-nest-fora.md) | A demo do TCC é o motor, com a empresa só simulada (sem compra nem login); o NestJS sai do critério de pronto do MVP | 2026-11-02 | valendo |
| [0029](0029-callback-de-registro-vira-simbolo.md) | Dentro de função, só o callback de registro de rota vira símbolo; a topologia desce nos outros callbacks de um chamador | 2026-11-03 | valendo |
| [0030](0030-parametro-recebe-o-pacote-de-quem-chama.md) | Um parâmetro sem tipo vale o que quem chama passa a ele; provado só se toda chamada passa; só pelo nome `prisma` sai `heuristic` | 2026-11-03 | valendo |
| [0031](0031-registro-de-exemplo-pelo-catalogo.md) | O `reset` gerado grava um registro por tabela, lido do catálogo do banco, com valores fixos e diferentes dos corpos de exemplo | 2026-11-03 | valendo |
| [0032](0032-demo-abre-em-projeto-real.md) | A demo abre num projeto real (pg-crud), com a extensão instalada pelo `.vsix`, e segue para o `checkout`; os atalhos ficam na Área de Trabalho |
| [0033](0033-atalhos-da-demo-no-repositorio.md) | Os atalhos da demo ficam no repositório e preparam o realworld sozinhos; o resultado do caos é apagado a cada abertura | 2026-11-06 | valendo |
| [0034](0034-um-projeto-de-caos-por-package-json.md) | O caos testa um projeto por vez: a subpasta com `package.json` próprio fica de fora, e rota de C#/Java não conta como projeto | 2026-11-06 | valendo |
| [0035](0035-nao-se-aplica.md) | Com o controle verde e a falha sem disparar, o resultado é "não se aplica", com o motivo ao lado; o controle que falhou segue "inválido" | 2026-11-06 | valendo |
| [0036](0036-contrato-antes-da-escolha-da-ia.md) | O contrato sai do mapa, sem IA, e sem pendência o teste segue sozinho; "Motor ou IA" vira o passo 2, sobre quem propõe as falhas | 2026-11-06 | valendo |
| [0039](0039-entrar-encenado.md) | O "Entrar" da landing abre `/entrar`: um 404 encenado e o ShielDepy reconstruindo a tela de login (mockada; a segunda versão segue o roteiro ditado pelo usuário, com peças 3D, balões líquidos e quatro cursores); o `/login` de verdade não muda | 2026-11-11 | valendo |
| [0040](0040-threejs-no-entrar.md) | three.js só na encenação do "Entrar" (num pedaço à parte), com as letras 3D tiradas da fonte do navegador (contorno dos pixels extrudado), luz e sombra; sem WebGL, fica o 3D em CSS | 2026-11-12 | valendo |
| [0041](0041-sons-do-entrar.md) | Sons baixinhos na encenação do "Entrar" (Epidemic Sound, pela conta do usuário), tocados com Web Audio, ligados por padrão e variando só o tom; os arquivos no repositório, com a licença da conta do usuário | 2026-11-12 | valendo |
| [0042](0042-landing-leve.md) | Landing leve: os loops decorativos lentos num relógio de 20 quadros/s (só na tela) e um modo leve (celular, aparelho fraco ou quadros lentos) sem desfoque de fundo, refração nem blurs grandes | 2026-11-13 | valendo |
