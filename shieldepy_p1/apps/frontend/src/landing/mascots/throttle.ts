// Mascotes a 20 quadros por segundo. A animação original (SVGator → CSS) mexe em caminhos e grupos do SVG:
// roda no thread principal e refaz o layout do desenho a cada quadro. Para um personagem em loop lento, 20/s
// basta. As animações ficam pausadas e um timer (não requestAnimationFrame: ele faria o navegador montar 60
// quadros/s e arrastaria junto todas as outras animações da página) avança o relógio delas, só enquanto o
// mascote está na tela.
import { reduceMotion } from '../motion';

export function throttleMascot(root: Element | null, prefix: string): () => void {
  if (!root || reduceMotion() || !root.getAnimations) return () => {};
  const anims = root
    .getAnimations({ subtree: true })
    .filter((a): a is CSSAnimation => ((a as CSSAnimation).animationName || '').startsWith(prefix));
  if (!anims.length) return () => {};
  anims.forEach((a) => a.pause());
  const STEP = 50;
  let timer = 0;
  let t = 0;
  let last = 0;
  const tick = () => {
    const now = performance.now();
    t += Math.min(now - last, 200);
    last = now;
    anims.forEach((a) => (a.currentTime = t));
  };
  const setOn = (on: boolean) => {
    if (on && !timer) {
      last = performance.now();
      timer = window.setInterval(tick, STEP);
    } else if (!on && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };
  let vis = false;
  const io = new IntersectionObserver((entries) => {
    vis = entries[0]!.isIntersecting;
    setOn(vis && !document.hidden);
  });
  io.observe(root);
  const onVisibility = () => setOn(vis && !document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    setOn(false);
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
