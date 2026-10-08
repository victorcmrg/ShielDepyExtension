// Laço de rolagem único da landing: um listener de scroll, um requestAnimationFrame por quadro, e as
// seções penduram "jobs" nele. Cada job tem duas fases:
//   measure() — lê o layout (getBoundingClientRect/offset*) e guarda em cache. Roda só no começo e
//               quando algo muda de tamanho (resize, altura da página, fontes carregadas).
//   frame()   — a cada quadro de rolagem: só contas com scrollY + escritas de estilo, nenhuma leitura
//               de layout (ler logo depois de escrever obrigaria o navegador a recalcular tudo).
// Todos os measure rodam antes de qualquer frame.

export interface ScrollJob {
  measure?(): void;
  frame(): void;
}

const jobs = new Set<ScrollJob>();
let installed = false;
let frameQueued = false;
let layoutQueued = false;

function runFrames() {
  jobs.forEach((j) => j.frame());
}

function onScroll() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    runFrames();
  });
}

/** Mede tudo de novo (no próximo quadro, uma vez só por mais que seja chamado) e redesenha. */
export function relayout(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    jobs.forEach((j) => j.measure?.());
    runFrames();
  });
}

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', relayout);
  // a altura da página muda (fontes, seções que só renderizam perto da tela): mede de novo
  new ResizeObserver(relayout).observe(document.body);
  document.fonts?.ready.then(relayout);
}

export function addScrollJob(job: ScrollJob): () => void {
  install();
  jobs.add(job);
  relayout();
  return () => {
    jobs.delete(job);
  };
}
