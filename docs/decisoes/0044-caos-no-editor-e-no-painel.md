# 0044 — O caos no editor e no painel do mapa: tipos no Explorer e uma seção Caos precisa

**Data:** 2026-11-13 (pedido do usuário: os indicadores do caos no código "como antigamente", a contagem por tipo no nome do arquivo e a seção Caos do mapa organizada, precisa e sem simplificar) · **Estado:** valendo

**Contexto.** Os indicadores do caos no código já existiam: cada teste que quebra vira diagnóstico (Problems e sublinhado), marca-texto por severidade (vermelho, amarelo, verde) com hover, e decoração do arquivo no Explorer. O usuário não os via porque o resultado aberto tinha **os 12 testes inválidos**: foi rodado na raiz do repositório (misturando os quatro exemplos de checkout) e o `checkout-express-fixed` estava sem `node_modules`, então o `express` não carregava e nenhum achado foi gerado. A seção Caos mostrava isso com dois avisos amarelos empilhados, quatro cartões grandes de zeros e a mensagem crua do Vitest repetida.

**Decisão.**
- **Explorer:** o selo do arquivo mostra as formas de **cada tipo presente**, do mais grave ao mais leve (■▲, ▲●), na cor do mais grave (`explorerBadge.ts`, testado). O VS Code aceita no máximo 2 caracteres no selo, então com os três tipos ficam os dois mais graves; a contagem vem ao lado, a dos diagnósticos do próprio VS Code, e a dica do arquivo traz os números de cada tipo.
- **Seção Caos do mapa** (`packages/viewer`, vale para a extensão e para o `--html` da CLI), de cima para baixo:
  - **veredito** numa frase (portão bloqueado, liberado com achados, aguentou, inconclusivo, não rodou), com a forma do semáforo;
  - **barra de composição** dos testes por resultado (quebrou, aguentou, inválido listrado, não se aplica, sem teste) e a legenda com os números, que continua filtrando o grafo;
  - **ficha da execução** (hipóteses e rotas, motor, portão, escopo, mapa atual ou desatualizado), no lugar dos avisos;
  - **achados** com a severidade, a rota, o que a falha quer dizer, a invariante violada, o teste e a duração;
  - **causas** dos testes que não valeram, uma por motivo: a mensagem do Vitest vira o que fazer ("Dependência não instalada: express", importada por qual arquivo, o comando para instalar na pasta certa), e a mensagem original fica recolhida;
  - **por rota**: cada falha injetada com o alvo, o resultado e a duração (no VS Code, clicar abre o teste).

**Consequências.**
- Para ver os indicadores no código, o caos precisa ter rodado com testes válidos num projeto com as dependências instaladas: por exemplo, `npm run cli -- chaos examples/checkout-express --offline` dá 6 achados.
- A causa "Failed to load url" é lida do texto de runtime do Vitest (regex em texto de runtime é permitido, [0002](0002-tree-sitter-sem-regex.md)); mensagens que o painel não reconhece aparecem como vieram.
