# 0038 — O mapa guarda as posições já calculadas e tem o próprio tema

**Data:** 2026-11-06 (pedido do usuário; os detalhes técnicos, decisão do Claude) · **Estado:** valendo

**Contexto.** No repositório inteiro (~4 mil nós, ~6 mil elementos na tela), o mapa levava ~3,6 s para aparecer, e o layout (fcose) rodava de novo a cada "Voltar ao mapa" e a cada filtro. Medido no navegador, em páginas novas, o tempo se divide entre o cálculo de estilo do próprio Cytoscape (~0,25 ms por elemento, independente de quantos seletores há), o fcose e o primeiro desenho; desenhar cada quadro ao arrastar é barato (2 a 50 ms). O webview do mapa também seguia o tema do sistema operacional, então com o VS Code escuro e o Windows claro ele ficava branco.

**Decisão.**
- **Posições guardadas, por combinação de filtros:** depois do fcose, o webview manda as posições (`{ type: 'layout' }`); o `MapPanel` guarda na memória e num arquivo na pasta temporária do sistema (`shieldepy-map/<hash da raiz>.json`, até 6 combinações). Na abertura seguinte, mesmo depois de fechar o VS Code, o mapa reaplica as posições em vez de rodar o fcose. Se até 10% dos nós são novos, eles entram perto dos vizinhos; acima disso, layout novo. No HTML da CLI, o mesmo cache vai para o `localStorage`.
- **O mapa fica vivo enquanto um fluxo é mostrado:** o fluxo abre numa segunda instância, por cima; "Voltar ao mapa" só a fecha.
- **Sem os elementos no construtor do Cytoscape** (ele rodava um layout padrão que o fcose jogava fora) e **realce em lote** (`batch`).
- **Botão sol/lua no canto do mapa:** sem escolha, o mapa segue o tema do VS Code (a classe do `body`) e, fora dele, o do sistema; a escolha fica no `MapPanel` (ou no `localStorage`, na CLI). Voltar ao tema do VS Code é voltar a segui-lo.
- **O desenho do grafo não muda:** mesmas cores, formas e parâmetros do fcose. Mudou a interface em volta (painel lateral e os dois botões do painel da extensão), nos tokens do `common.css`.
- **Acréscimo de 2026-11-11 (pedido do usuário):** o nó com erro (rota que quebrou e operação alvo de achado) ganha um pulso vermelho leve, além da borda. O pulso é uma camada HTML por cima do grafo, com animação CSS só de `transform`/`opacity`; o Cytoscape não anima nada (animar o estilo dele redesenharia o grafo inteiro a cada quadro). Os anéis se reposicionam no evento `render`, um quadro por vez, e somem fora da tela; com "reduzir movimento", o anel fica parado. Os cartões do caos (achados, aguentou, inválidos, sem teste, não se aplica) viraram botões: clicar apaga o resto do grafo e deixa só as rotas daquele grupo (em "achados", também as operações alvo); clicar de novo, ou no fundo do grafo, volta tudo. A página não rola mais além do fim: o input escondido de cada chave se posicionava pela página e, com o painel rolado, a esticava.

**Consequências.**
- Reabrir o mapa caiu de ~3,6 s para ~1,5 s, e voltar de um fluxo ficou instantâneo. **A primeira abertura de cada projeto não ficou mais rápida:** o que sobra é custo do Cytoscape e do fcose; cortar mais pediria esconder elementos, trocar o layout ou levar o fcose para um worker.
- O cache é descartável: arquivo apagado ou corrompido só faz o próximo layout ser calculado de novo.
