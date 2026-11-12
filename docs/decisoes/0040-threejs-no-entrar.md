# 0040 — three.js só na encenação do "Entrar", com as letras tiradas da fonte do navegador

**Data:** 2026-11-12 (pedido do usuário: "use three.js para melhorar o 3D") · **Estado:** valendo

**Contexto.** A encenação do `/entrar` ([0039](0039-entrar-encenado.md)) fazia todo o 3D em CSS: o 404 que cai era uma pilha de cópias do caractere em `translateZ`, sem luz nem sombra de verdade. O usuário pediu three.js para melhorar o 3D e usá-lo em outras partes.

**Decisão.**
- **three.js 0.186.1** (dependência do `apps/web`; a 0.187.0 saiu há menos de duas semanas), carregado com `import()` só pelo motor do `/entrar`: fica num pedaço à parte (~564 KB, ~143 KB comprimido) que só quem abre a encenação baixa. O resto do portal não muda de tamanho.
- **As letras 3D saem da fonte do navegador**, não de um arquivo de fonte: o pacote do three.js não traz mais as fontes prontas, e baixar uma fonte de fora pediria a autorização do usuário. Cada caractere é desenhado num canvas com a mesma fonte do HTML; o contorno dos pixels (com os furos, como o miolo do "0") vira uma forma (`entrar/contour.ts`, puro e testado), suavizada, e a forma é extrudada com chanfro. A letra 3D nasce idêntica ao 404 da página e assume no instante em que a gravidade começa.
- **O que o three.js desenha:** o 404 e o "Página não encontrada" caindo (a física continua a mesma, `physics.ts`), com luz, sombra numa parede branca atrás e no chão; e o confete 3D do encontro do fim. Os cursores, cartões e painéis continuam no DOM, porque precisam passar uns na frente dos outros (um canvas não se mistura com o DOM em profundidade).
- **Sem WebGL, ou se o pedaço não carregar a tempo,** as letras seguem no 3D em CSS, como antes.

**Consequências.**
- O renderizador das letras é descartado quando elas saem do quadro, e o do confete quando ele acaba: a GPU fica livre no resto da cena.
- Trocar a fonte do 404 no CSS troca a das letras 3D junto, sem arquivo novo.
