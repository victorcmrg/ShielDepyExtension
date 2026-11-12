// Um relógio só para os loops decorativos lentos da landing (a bola do topo, a textura dos botões, os
// mascotes, a malha de cor dos planos, a borda que gira). Rodando sozinhas, essas animações obrigam o
// navegador a montar 60 quadros por segundo mesmo com a página parada, e em celular ou PC fraco isso é o
// que pesa (decisão 0042). Aqui elas ficam pausadas e um timer (não requestAnimationFrame: ele também
// pediria 60 quadros/s) avança o relógio delas a 20 quadros por segundo, ou 12 no modo leve, e só
// enquanto estão na tela. Para movimentos de 10 a 140 s por volta, a diferença não aparece.
import { reduceMotion } from './motion';

interface Group {
  anims: CSSAnimation[];
  /** onde cada animação estava quando entrou no relógio (para não pular de fase) */
  from: number[];
  /** o relógio quando o grupo entrou */
  t0: number;
  vis: boolean;
}

const groups = new Set<Group>();
let timer = 0;
let t = 0;
let last = 0;
let fps = 20;
let listening = false;

function tick() {
  const now = performance.now();
  t += Math.min(now - last, 200);
  last = now;
  groups.forEach((g) => {
    if (!g.vis) return;
    g.anims.forEach((a, i) => (a.currentTime = g.from[i]! + t - g.t0));
  });
}

function sync() {
  let on = false;
  if (!document.hidden) groups.forEach((g) => (on ||= g.vis));
  if (on && !timer) {
    last = performance.now();
    timer = window.setInterval(tick, 1000 / fps);
  } else if (!on && timer) {
    clearInterval(timer);
    timer = 0;
  }
}

/** Troca a taxa do relógio (o modo leve usa 12). */
export function setAmbientFps(n: number): void {
  if (n === fps) return;
  fps = n;
  if (timer) {
    clearInterval(timer);
    timer = 0;
    sync();
  }
}

/** As animações de `root` (e de dentro dele) cujo nome passa em `match` passam a andar no relógio. */
export function ambient(root: Element | null, match: (name: string) => boolean): () => void {
  if (!root || reduceMotion() || !root.getAnimations) return () => {};
  const anims = root
    .getAnimations({ subtree: true })
    .filter((a): a is CSSAnimation => match((a as CSSAnimation).animationName || ''));
  if (!anims.length) return () => {};
  anims.forEach((a) => a.pause());
  const g: Group = { anims, from: anims.map((a) => Number(a.currentTime) || 0), t0: t, vis: false };
  groups.add(g);
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', sync);
  }
  const io = new IntersectionObserver((entries) => {
    g.vis = entries[entries.length - 1]!.isIntersecting;
    sync();
  });
  io.observe(root);
  return () => {
    io.disconnect();
    groups.delete(g);
    sync();
  };
}
