# 0039 — O "Entrar" da landing abre uma encenação; o login de verdade fica em /login

**Data:** 2026-11-11 (pedido do usuário) · **Estado:** valendo

**Contexto.** O usuário pediu que o botão "Entrar" do site mostrasse um 404 "quebrado" por 1,5 s e, depois, o ShielDepy "detectando o erro" e reconstruindo a tela de login aos poucos, de um jeito bem cinematográfico, terminando numa tela de login mockada. O portal já tem um login de verdade em `/login` (e-mail e senha, Google e GitHub), e ele é usado também pela extensão (`/login?device_state=…`), pelo retorno do OAuth (`/login?error=…`) e pelo portal quando a sessão cai (`/login?redirect=…`).

**Decisão.**
- **A encenação é uma rota nova do portal, `/entrar`**, num pedaço separado (lazy, ~9 KB de JS e ~11 KB de CSS): quem não clica em "Entrar" não baixa nada. Os dois links "Entrar" da landing (o do menu e o do rodapé) apontam para ela; o "Criar conta agora" segue indo para `/login`.
- **O `/login` não mudou.** Trocar a tela dele quebraria a extensão, o OAuth e o redirecionamento do portal, que entram por ali com parâmetros. A tela final da encenação é mockada (não envia nada); ao clicar no botão, ela avisa que é uma encenação e leva ao `/login`.
- **Leve:** o roteiro (tempos, mensagens, ordem) é um módulo puro, `apps/web/src/portal/pages/entrar/timeline.ts`, testado em `apps/web/test/entrar-timeline.test.ts`. Um `requestAnimationFrame` só troca o passo quando o roteiro anda e escreve o título e o timecode direto no DOM; o resto é CSS com `transform` e `opacity` (a "câmera" usa a Web Animations API). Trocas de cor, fonte e borda acontecem de uma vez, no instante em que o bloco é corrigido. Nenhuma biblioteca nova.
- **Tempos:** 1,5 s de 404 e 6,5 s de reconstrução (8 s ao todo). Clique ou tecla pula para o fim (a câmera acelera em vez de cortar). Com `prefers-reduced-motion`, o 404 vai direto para a tela pronta.
- **O fundo nasce branco:** o `theme-init.js` marca o `<html>` com `data-boot="404"` em `/entrar`, e o `portal.css` pinta o fundo de branco com essa marca, para o tema escuro não aparecer antes do 404. A página tira a marca quando a reconstrução começa.

**Consequências.**
- Em aba escondida o navegador pausa o `requestAnimationFrame`: a encenação para e, ao voltar, pula para o ponto do relógio (ou para o fim).
- Quem quer entrar de verdade pela landing passa pela encenação e mais um clique. Se isso incomodar, basta voltar os dois links para `/login`.
