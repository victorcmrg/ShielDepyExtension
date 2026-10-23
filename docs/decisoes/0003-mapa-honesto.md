# 0003 — Ligação sem prova sai como `heuristic`; o mapa não depende da ordem

**Data:** 2026-10-07 · **Estado:** valendo

**Contexto.** Nem toda chamada dá para resolver (injeção dinâmica, nomes repetidos). Esconder isso faria o mapa parecer mais certo do que é.

**Decisão.**
- A ligação que não dá para provar é marcada como `heuristic` (resolvida só pelo nome). Isso nunca é escondido.
- O mapa dá o mesmo resultado em qualquer ordem de indexação dos arquivos.

**Consequências.** Há um teste de ordem na suíte, e o `npm run mapa:reais` mede o mapa em projetos reais do GitHub (fixados por commit, clonados fora do repositório).
