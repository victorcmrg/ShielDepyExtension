# 0046 — O mapa responde na hora: troca de filtro sem recriar o grafo, e o layout num Web Worker

**Data:** 2026-11-13 (pedido do usuário: "quando clico para fazer alguma alteração no mapa ele laga muito"; pediu o trabalho em outra thread e, se preciso, em duas partes que se atualizam uma depois da outra) · **Estado:** valendo

**Contexto.** No mapa deste repositório (4,5 mil nós, 11 mil arestas), cada troca de filtro travava a tela por 2 a 3 s, e depois ainda vinha o desenho. Medido no visualizador gerado pela CLI:
- **~0,9–2 s no enquadramento** (`fit`): o `boundingBox()` do Cytoscape mede o rótulo de cada elemento e a curva de cada aresta;
- **reaplicar o estilo** a ~13 mil elementos, porque cada troca destruía o grafo e criava outro do zero;
- **~0,75 s de `fcose`** na thread da tela, quando aquela combinação de filtros não tinha posições guardadas. Acima de 6 mil elementos ele rodava só no modo `draft` para não travar mais, e muitos nós caíam no mesmo lugar (731 posições diferentes para 2.209 nós).

**Decisão** (`packages/viewer`, vale para a extensão e para o `--html` da CLI):
- **Troca de filtro sem recriar o grafo:** com o mesmo agrupamento, o grafo da tela só tira o que saiu e põe o que entrou. Os nós novos entram perto dos vizinhos (ou na caixa do arquivo deles); o resto não sai do lugar e não refaz estilo. Trocar o agrupamento ainda recria o grafo, porque muda o pai de todos os nós.
- **Enquadramento pela caixa das posições** (`quickBox`/`fitQuick`), sem medir rótulos: ~2 ms. O mesmo vale para as paredes do arrasto e a imagem de fundo.
- **O `fcose` num Web Worker**, criado de um Blob com as mesmas bibliotecas da página: no HTML da CLI, o texto das tags inline; no webview, baixadas da extensão (CSP com `worker-src blob:` e `connect-src` da extensão). Os rótulos não se medem no worker; cada nó vai com o tamanho do desenho mais o do rótulo, medidos num canvas na página.
- **Em duas partes:** a parte 1 mostra o mapa na hora com as posições que já se têm (as guardadas, ou as da tela, ou provisórias). A parte 2 é o worker. No mapa grande, ele devolve primeiro o rascunho (`draft`) e depois o refino com qualidade cheia a partir dele; cada passo atualiza a tela, e o aviso "Organizando o mapa…" fica no topo até o fim. O layout só roda quando falta posição para mais de 10% dos nós, ou quando o anterior ainda não chegou. Uma troca no meio do cálculo descarta o pedido antigo e pede de novo.
- **Sem worker** (navegador sem suporte ou CSP que bloqueie): o `fcose` roda na página, como antes.

**Consequências.**
- Medido no painel escondido do navegador do app (mais lento que o normal): a parte síncrona de uma troca de filtro caiu de 2–3,4 s para 0,06–0,5 s, e a de agrupamento para ~0,6–1 s. O mapa abre com o rascunho em menos de 1 s, e o refino acontece em segundo plano. No mapa grande, todos os nós saem em posições distintas.
- **O que continua na thread da tela:** desenhar o mapa grande inteiro (~0,7–1 s por quadro com 6 mil elementos à vista, no Cytoscape 3.30 em canvas). Para tirar isso, o caminho seria o desenho em WebGL do Cytoscape 3.31+, que é experimental e muda o visual; fica para outra decisão.
- Não conferido dentro do VS Code: o worker no webview depende da CSP nova e do `fetch` das bibliotecas pela URI da extensão. Se falhar, o mapa volta ao `fcose` na página, sem quebrar.
