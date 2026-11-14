# 0051 — A demo da landing em vídeo pré-renderizado

**Data:** 2026-11-14 (pedido do usuário: "para otimização, renderize esse motion design… tudo que fica para fora do campo do motion design ignore… um vídeo leve, com carregamento rápido") · **Estado:** valendo

**Contexto.** A seção Demo da landing é um monitor com uma tela de editor animada: uma linha do tempo de 26 s em HTML (`render(t)` determinístico), redesenhada a 60 quadros por segundo enquanto visível. Em volta, bolhas de vidro ("Colisão provada", "Correção verificada", "Merge liberado") ficam fora da tela.

**Decisão.**
- **A tela do monitor vira vídeo**, como o "Entrar" ([0043](0043-entrar-em-video.md)). Só a tela entra (o quadro `.vid`, que a tela recorta); as bolhas, o monitor e o fundo seguem em HTML.
- **Captura:** `/?capture=demo` no `web:dev` deixa a linha do tempo parada e solta a tela no canto da página; `apps/web/scripts/demo-video/capture.mjs` (Edge/Chrome headless pelo CDP) avança o relógio e as animações de CSS em 1/30 s por quadro e fotografa a janela do tamanho exato da tela. Duas versões: a larga (1000×625 a 1,6×, 1600×1000) e a compacta do celular (560×350 a 2×, 1120×700).
- **Codificação** (`encode.mjs`, sem som, 30 quadros/s, 26 s em laço): AV1 10 bits (458 KB e 421 KB), H.264 com faststart (545 KB e 536 KB) e o poster em WebP (28 KB e 22 KB). PSNR médio de 47 dB (AV1) e 52 dB (H.264) contra os quadros.
- **Na página:** um `<video>` mudo, em laço, `preload="none"`, com o poster; baixa quando a seção chega a 600 px da tela, toca só com o monitor reto, visível e com a aba aberta, e escolhe a versão pela largura da tela (a mesma regra de antes, 520 px). O player (play, barra, capítulo, tempo) e as bolhas leem `video.currentTime`. Com `prefers-reduced-motion`, fica parado em 14,8 s.
- **O HTML animado sai de produção:** ele só existe no modo de captura (o código vai embora no build); a linha do tempo fica no `Demo.tsx` para gerar o vídeo de novo quando a cena mudar.

**Consequências.**
- Mudou a cena: rodar a captura e a codificação das duas versões de novo (precisa do `web:dev`).
- A tela fica escura nos dois temas (as cores dela já eram fixas).
