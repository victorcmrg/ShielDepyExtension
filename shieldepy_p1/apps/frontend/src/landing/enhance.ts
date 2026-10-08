// Efeitos de página inteira da landing, ligados uma vez depois da hidratação (Landing.tsx). São
// decorativos e leem o DOM já desenhado pelo React — as seções não precisam saber deles.
import { addScrollJob } from './scroll';
import { idle, indexChildren, reduceMotion } from './motion';

type Cleanup = () => void;

/** Títulos palavra por palavra, listas em sequência e blocos que sobem: ganham `.in` ao entrar na tela. */
export function initReveal(): Cleanup {
  document.querySelectorAll('.split').forEach((el) => indexChildren(el, '.sw'));
  document.querySelectorAll('.stagger').forEach((el) => indexChildren(el));
  document.querySelectorAll<HTMLElement>('.plan.reveal').forEach((el, i) => (el.style.transitionDelay = i * 110 + 'ms'));
  const revealables = document.querySelectorAll('.split, .stagger, .reveal');
  if (reduceMotion() || !('IntersectionObserver' in window)) {
    revealables.forEach((el) => el.classList.add('in'));
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }),
    { rootMargin: '0px 0px -10% 0px' }
  );
  revealables.forEach((el) => io.observe(el));
  return () => io.disconnect();
}

/** Seções fora da tela ([data-pause]): animações pausadas. */
export function initPauseOffscreen(): Cleanup {
  if (!('IntersectionObserver' in window)) return () => {};
  const pauser = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.target.classList.toggle('paused', !e.isIntersecting)),
    { rootMargin: '-1px 0px' } // só encostar na borda da tela não conta como visível
  );
  document.querySelectorAll('[data-pause]').forEach((el) => pauser.observe(el));
  return () => pauser.disconnect();
}

/** Liga os loops contínuos (bola, tinta dos botões) só quando as animações de entrada do topo já acabaram. */
export function initLoops(): Cleanup {
  let timer = 0;
  const start = () => (timer = window.setTimeout(() => document.documentElement.classList.add('loop-on'), 2200));
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  return () => {
    clearTimeout(timer);
    window.removeEventListener('load', start);
  };
}

/** Cartões com luz (.spot): um halo verde acompanha o cursor por dentro do cartão. */
export function initSpotlight(): Cleanup {
  if (reduceMotion()) return () => {};
  const offs: Cleanup[] = [];
  document.querySelectorAll<HTMLElement>('.spot').forEach((c) => {
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
    };
    c.addEventListener('pointermove', move);
    offs.push(() => c.removeEventListener('pointermove', move));
  });
  return () => offs.forEach((off) => off());
}

// ---------------- vidro líquido ----------------
// Para cada peça .lg, um mapa de deslocamento do tamanho exato dela: perto da borda o fundo é puxado para
// dentro (como a borda grossa de uma lente), com os canais R/G/B deslocados em escalas um pouco diferentes.
// backdrop-filter com url() só funciona no Chromium; nos outros fica o desfoque do CSS.

const GLASS: Record<string, { bezel: number; scale: number }> = { card: { bezel: 22, scale: 40 } };
const mapCache = new Map<string, string>();

function glassMap(w: number, h: number, r: number, bezel: number): string {
  const key = `${w}x${h}x${r}x${bezel}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const cx = px < r ? r : px > w - r ? w - r : px;
      const cy = py < r ? r : py > h - r ? h - r : py;
      let dist: number;
      let nx = 0;
      let ny = 0;
      if (cx !== px && cy !== py) {
        const dx = px - cx;
        const dy = py - cy;
        const len = Math.hypot(dx, dy) || 1;
        dist = r - len;
        nx = dx / len;
        ny = dy / len;
      } else {
        dist = Math.min(px, w - px, py, h - py);
        if (dist === px) nx = -1;
        else if (dist === w - px) nx = 1;
        else if (dist === py) ny = -1;
        else ny = 1;
      }
      const k = dist >= bezel ? 0 : Math.pow(1 - Math.max(dist, 0) / bezel, 2);
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * k * 127;
      d[i + 1] = 128 - ny * k * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  mapCache.set(key, url);
  return url;
}

const NS = 'http://www.w3.org/2000/svg';
function svgEl(name: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, name);
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  return el;
}

function updateGlass(defs: SVGSVGElement, el: HTMLElement, idx: number) {
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  if (w < 4 || h < 4) return;
  const cfg = GLASS[el.dataset.lg ?? ''] ?? GLASS.card!;
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
  const bezel = Math.min(cfg.bezel, h / 2, w / 2);
  const sig = `${w}x${h}x${r}`;
  if (el.dataset.lgSig === sig) return;
  el.dataset.lgSig = sig;
  const id = `lg-${idx}`;
  let f = defs.querySelector<SVGFilterElement>('#' + id);
  if (!f) {
    f = svgEl('filter', { id, x: 0, y: 0, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }) as SVGFilterElement;
    defs.appendChild(f);
  }
  f.setAttribute('width', String(w));
  f.setAttribute('height', String(h));
  f.replaceChildren(
    // o mapa é suave: gerado em meia resolução (¼ dos pixels) e esticado pelo próprio filtro
    svgEl('feImage', { href: glassMap(Math.ceil(w / 2), Math.ceil(h / 2), Math.round(r / 2), bezel / 2), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }),
    svgEl('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: cfg.scale, xChannelSelector: 'R', yChannelSelector: 'G' })
  );
  el.style.setProperty('--lg-filter', `url(#${id})`);
  el.classList.add('lg-ready');
}

/** Vidro (.lg): refração nas peças com fundo parado + brilho que segue o mouse em todas. */
export function initGlass(defs: SVGSVGElement | null): Cleanup {
  const offs: Cleanup[] = [];
  const reduce = reduceMotion();
  const glassEls = Array.from(document.querySelectorAll<HTMLElement>('.lg'));
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? [];
  const liquid = !reduce && !!defs && brands.some((b) => /Chromium/i.test(b.brand));

  // A refração (filtro SVG atrás do vidro) é refeita a cada quadro quando o que está atrás se mexe. Medido: no
  // menu (por cima da bola girando, do vídeo, da rolagem) ela sozinha ocupava mais da metade da GPU. Por isso só
  // fica nas peças com fundo parado; o menu, as bolhas e o player ficam com o vidro desfocado + borda + reflexo.
  const refractEls = glassEls.filter((el) => el.dataset.lg === 'card');
  if (liquid && defs && refractEls.length) {
    document.documentElement.classList.add('lg-on');
    // cada peça só ganha o mapa quando aparece (perto da tela), num momento ocioso
    const dirty = new Set<HTMLElement>();
    const near = new Set<HTMLElement>();
    let queued = false;
    const flush = () => {
      queued = false;
      dirty.forEach((el) => {
        if (!near.has(el)) return;
        updateGlass(defs, el, refractEls.indexOf(el));
        dirty.delete(el);
      });
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      idle(flush, 150);
    };
    const ro = new ResizeObserver((entries) => {
      entries.forEach((e) => dirty.add(e.target as HTMLElement));
      queue();
    });
    const vis = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? near.add(e.target as HTMLElement) : near.delete(e.target as HTMLElement)));
        queue();
      },
      { rootMargin: '300px 0px' }
    );
    refractEls.forEach((el) => {
      ro.observe(el);
      vis.observe(el);
    });
    offs.push(() => {
      ro.disconnect();
      vis.disconnect();
    });
  }

  // Brilho do vidro que segue o mouse (também redesenhado quando a página rola por baixo do cursor).
  if (!reduce) {
    let mouse: { x: number; y: number } | null = null;
    let glintQueued = false;
    const glint = () => {
      glintQueued = false;
      if (!mouse) return;
      const rects = glassEls.map((el) => el.getBoundingClientRect());
      glassEls.forEach((el, i) => {
        const r = rects[i]!;
        if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
        el.style.setProperty('--gx', (mouse!.x - r.left).toFixed(0) + 'px');
        el.style.setProperty('--gy', (mouse!.y - r.top).toFixed(0) + 'px');
      });
    };
    const queueGlint = () => {
      if (glintQueued || !mouse) return;
      glintQueued = true;
      requestAnimationFrame(glint);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      mouse = { x: e.clientX, y: e.clientY };
      queueGlint();
    };
    window.addEventListener('pointermove', move, { passive: true });
    offs.push(() => window.removeEventListener('pointermove', move));
    offs.push(addScrollJob({ frame: queueGlint }));
  }
  return () => offs.forEach((off) => off());
}
