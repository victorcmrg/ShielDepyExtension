# 0042 — Landing leve: os loops decorativos num relógio de 20 quadros/s e um modo leve para aparelhos fracos

**Data:** 2026-11-13 (pedido do usuário: "a landing está mal otimizada… em celulares ou PCs mais fracos o site fica lento") · **Estado:** valendo

**Contexto.** Medido no build de produção (`vite preview`), num PC forte: a página roda a 60 quadros/s, cada quadro custa de 2 a 4,5 ms, e a entrada tem três quadros longos (118, 59 e 59 ms), quase tudo em calcular estilo e layout da página inteira. O custo que pesa em aparelho fraco é o fixo: com a página parada no topo, 8 animações infinitas (as 4 camadas da bola verde, a textura dos botões, o mascote flutuando…) faziam o navegador montar 60 quadros por segundo sem parar, e o menu de vidro refazia o desfoque de fundo a cada quadro por cima da bola girando.

**Decisão.**
- **Um relógio só para os loops decorativos lentos** (`src/landing/ambient.ts`): a bola do topo, a textura dos botões, o `tex-move`, o balanço do mascote da segurança, a malha dos planos, a borda que gira no fim e os dois mascotes SVG (que já andavam assim, a 20 quadros/s, e agora usam o mesmo relógio). As animações ficam pausadas e um timer avança o relógio delas a 20 quadros/s, só enquanto estão na tela. Com a página parada, não sobra animação a 60 quadros/s. Para movimentos de 10 a 140 s por volta, a diferença não aparece.
- **Modo leve** (`.lite` no `<html>`): o `theme-init.js` marca antes do primeiro quadro em celular (toque e até 900 px), com até 4 núcleos, até 4 GB de memória ou com economia de dados. Um vigia (`src/landing/perf.ts`) mede ~45 quadros depois da entrada e liga o modo se a mediana passar de 26 ms. No modo leve: sem desfoque de fundo nem refração no vidro (o menu fica com a tinta mais opaca), sem os desfoques grandes (a luz do topo e a malha dos planos), o título entra sem blur, e o relógio anda a 12 quadros/s.
- **Menos trabalho na entrada:** a história e os planos também ficam com `content-visibility: auto`, como a segurança, o fim, o rodapé e os recursos já estavam. A demonstração, o produto e a prova ficam de fora porque medem os próprios filhos na rolagem, o que obrigaria o navegador a montá-los do mesmo jeito.

**Consequências.**
- No PC forte: a entrada caiu para um quadro longo só (61 ms, 25 de estilo); com a página parada no topo, 87 de 192 intervalos ociosos passaram de 17 ms (o navegador fica mais de um quadro inteiro sem desenhar), contra nenhum com os loops a 60 quadros/s.
- Loop decorativo novo na landing: incluir na lista `AMBIENT` do `enhance.ts` para não voltar aos 60 quadros/s.
- O vidro no celular perde a refração e o desfoque de propósito.
