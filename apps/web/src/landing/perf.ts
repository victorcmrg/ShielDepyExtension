// Modo leve da landing (decisão 0042): em celular, PC com poucos núcleos ou pouca memória, ou com
// economia de dados, o theme-init.js já marca `.lite` no <html> antes do primeiro quadro. Aqui fica o
// vigia: se os quadros da entrada vierem lentos num aparelho que parecia forte, liga o modo leve também.
// No modo leve saem o desfoque de fundo (vidro), a refração e os desfoques grandes, e os loops
// decorativos andam a 12 quadros por segundo.
import { setAmbientFps } from './ambient';
import { reduceMotion } from './motion';

const LITE_FPS = 12;

export function isLite(): boolean {
  return document.documentElement.classList.contains('lite');
}

function goLite() {
  document.documentElement.classList.add('lite');
  setAmbientFps(LITE_FPS);
}

/** Liga o modo leve se a página já veio marcada; senão, mede ~45 quadros e liga se a mediana passar de 26 ms. */
export function watchFrames(): () => void {
  if (isLite()) {
    setAmbientFps(LITE_FPS);
    return () => {};
  }
  if (reduceMotion()) return () => {};
  const gaps: number[] = [];
  let raf = 0;
  let prev = 0;
  const loop = (now: number) => {
    if (prev && !document.hidden) gaps.push(now - prev);
    prev = now;
    if (gaps.length < 45) {
      raf = requestAnimationFrame(loop);
      return;
    }
    gaps.sort((a, b) => a - b);
    if (gaps[gaps.length >> 1]! > 26) goLite();
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
