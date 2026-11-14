// Demo: monitor 3D com um vídeo do sistema em motion design. A tela do monitor é um vídeo pré-renderizado
// (decisão 0051): leve e com carregamento rápido, no lugar do HTML animado a 60 quadros por segundo. O
// player (play, barra, capítulo, tempo) e as bolhas de vidro em volta seguem o tempo do vídeo.
//
// O vídeo sai da linha do tempo de 26 s abaixo: render(t) é determinístico e desenha qualquer instante.
// Ela só roda no modo de captura do web:dev (/?capture=demo): apps/web/scripts/demo-video/capture.mjs
// avança o relógio quadro a quadro e fotografa só a tela (o que sai dela, como as bolhas, fica de fora).
import { useEffect, useRef } from 'react';
import { clamp, ease, put, reduceMotion } from '../motion';
import { Lede, SplitTitle } from '../parts';
import { addScrollJob } from '../scroll';

/** Modo de captura do vídeo (só no web:dev): a tela volta a ser o HTML animado, parado, à espera do script. */
const CAPTURE = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('capture') === 'demo';

/** As versões do vídeo: a larga (a tela de 1000×625) e a compacta do celular (560×350, sem a barra lateral). */
const VARIANT = { wide: 'demo-1000', compact: 'demo-560' } as const;
const SOURCES = (name: string) => [
  { src: `/video/${name}-av1.webm`, type: 'video/webm; codecs="av01.0.08M.10"' },
  { src: `/video/${name}-h264.mp4`, type: 'video/mp4; codecs="avc1.640028"' },
];

const T = 26;
const CHAPTERS: [number, string][] = [
  [0, 'Digitando'],
  [3.4, 'Prova da colisão'],
  [7.2, 'O outro lado'],
  [11.2, 'Correção verificada'],
  [16.4, 'Correção aplicada'],
  [19.8, 'Portão no CI'],
];
type Token = [string, string?];
const LINE_A: Token[] = [['order.total', 'v-tok'], [' = order.subtotal * '], ['0.9', 'n'], [';']];
const LINE_B: Token[] = [['order.discount'], [' = order.subtotal * '], ['0.1', 'n'], [';']];
const lenOf = (tokens: Token[]) => tokens.reduce((n, [t]) => n + t.length, 0);
const CMD = 'shieldepy report services --fail-on critico';
type Spot = 'rest' | 'tok' | 'chat' | 'apply';
const PATH: [number, Spot][] = [
  [0, 'rest'],
  [5.0, 'rest'],
  [6.9, 'tok'],
  [11.0, 'tok'],
  [12.2, 'chat'],
  [15.0, 'chat'],
  [16.2, 'apply'],
  [18.6, 'apply'],
  [20.6, 'rest'],
  [T, 'rest'],
];
const fmtTime = (s: number) => `0:${String(Math.floor(s)).padStart(2, '0')}`;

/** Liga o vídeo, o player e a inclinação de entrada do monitor. Devolve a limpeza. */
function startDemo(stage: HTMLElement, controls: HTMLElement): () => void {
  const reduce = reduceMotion();
  const $ = <E extends Element = HTMLElement>(id: string) => (stage.querySelector<E>('#' + id) ?? controls.querySelector<E>('#' + id))!;
  const vid = $('vid');
  const mScreen = $('mScreen');
  const monitor = $('monitor');
  const v = {
    typed: $('vTyped'),
    caret: $('vCaret'),
    count: $('vCount'),
    status: $('vStatusText'),
    cmd: $('vCmd'),
    cmdCaret: $('vCmdCaret'),
    apply: $('vApply'),
    play: $('vidPlay'),
    track: $('vidTrack'),
    fill: $('vidFill'),
    chapter: $('vidChapter'),
    time: $('vidTime'),
    chips: [$('chipA'), $('chipB'), $('chipC')],
    cursor: $<SVGSVGElement>('vCursor'),
    click: $('vClick'),
    stageBg: stage.querySelector<HTMLElement>('.stage-bg')!,
  };
  const offs: (() => void)[] = [];

  let lineKey = '';
  function setLine(tokens: Token[], name: string, n: number) {
    const key = name + n;
    if (key === lineKey) return;
    lineKey = key;
    const frag = document.createDocumentFragment();
    let left = n;
    for (const [text, cls] of tokens) {
      if (left <= 0) break;
      const s = document.createElement('span');
      if (cls) s.className = cls;
      s.textContent = text.slice(0, left);
      left -= s.textContent.length;
      frag.appendChild(s);
    }
    v.typed.replaceChildren(frag);
    pointCache.delete('tok');
  }
  function setText(el: Element, text: string) {
    if (el.textContent !== text) el.textContent = text;
  }
  // Posição de um elemento dentro do vídeo (em px do desenho, sem as escalas/3D aplicadas por cima).
  function posIn(el: HTMLElement) {
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== vid) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    return n === vid && el.offsetWidth ? { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 } : null;
  }
  const pointCache = new Map<Spot, { x: number; y: number }>();
  function point(name: Spot) {
    const hit = pointCache.get(name);
    if (hit) return hit;
    const p = measurePoint(name);
    // só guarda quando o alvo já existe na tela (o "total" digitado, o botão do chat aberto)
    if (name === 'rest' || name === 'chat' || (name === 'tok' && vid.querySelector('.v-tok')) || (name === 'apply' && v.apply.offsetWidth)) pointCache.set(name, p);
    return p;
  }
  function measurePoint(name: Spot) {
    const W = vid.offsetWidth;
    const H = vid.offsetHeight;
    const rest = { x: W * 0.8, y: H * 0.78 };
    if (name === 'tok') {
      const tok = vid.querySelector<HTMLElement>('.v-tok');
      const p = tok && posIn(tok);
      return p ? { x: p.x + 8, y: p.y + 4 } : rest;
    }
    if (name === 'chat') return { x: W - 170, y: H * 0.5 };
    if (name === 'apply') return posIn(v.apply) || { x: W - 170, y: H * 0.5 };
    return rest;
  }
  function cursorAt(t: number) {
    let i = 0;
    while (i < PATH.length - 2 && t >= PATH[i + 1]![0]) i++;
    const [t0, a] = PATH[i]!;
    const [t1, b] = PATH[i + 1]!;
    const k = ease(clamp((t - t0) / (t1 - t0)));
    const p = point(a);
    const q = a === b ? p : point(b);
    return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  }

  function render(t: number) {
    const on = (cls: string, cond: boolean) => vid.classList.toggle(cls, cond);
    const fixed = t >= 16.9;
    if (fixed) setLine(LINE_B, 'B', lenOf(LINE_B));
    else setLine(LINE_A, 'A', Math.floor(clamp((t - 0.8) / 2.6) * lenOf(LINE_A)));
    v.caret.classList.toggle('on', t >= 0.4 && t < 3.6);
    const analyzing = t >= 3.5 && t < 4.5;
    const issue = t >= 4.5 && t < 16.9;
    on('s-analyzing', analyzing);
    on('s-issue', issue);
    on('s-hover', t >= 7.3 && t < 11.0);
    on('s-chat', t >= 11.3 && t < 19.8);
    on('s-msg1', t >= 11.9);
    on('s-dots', t >= 12.5 && t < 13.7);
    on('s-msg2', t >= 13.7);
    on('s-ok', t >= 14.4);
    on('s-apply', t >= 15.0);
    on('s-press', t >= 16.4 && t < 16.7);
    on('s-click', t >= 16.4 && t < 17.2);
    on('s-fixed', fixed);
    on('s-toast', t >= 17.3 && t < 20.2);
    on('s-term', t >= 19.9);
    setText(v.cmd, CMD.slice(0, Math.floor(clamp((t - 20.5) / 1.8) * CMD.length)));
    v.cmdCaret.classList.toggle('on', t >= 19.9 && t < 22.6);
    on('s-out1', t >= 22.7);
    on('s-out2', t >= 23.3);
    on('s-fade', t >= 25.4);
    setText(v.count, issue ? '1' : '0');
    setText(v.status, analyzing ? 'ShielDepy: analisando…' : issue ? 'ShielDepy: 1 colisão importante' : 'ShielDepy: protegido');
    const c = cursorAt(t);
    const cx = c.x.toFixed(1) + 'px';
    const cy = c.y.toFixed(1) + 'px';
    put(v.cursor, '--cx', cx);
    put(v.cursor, '--cy', cy);
    put(v.click, '--cx', cx);
    put(v.click, '--cy', cy);
    // as bolhas de vidro em volta acendem no momento delas
    v.chips[0]!.classList.toggle('lit', t >= 4.5 && t < 11.2);
    v.chips[1]!.classList.toggle('lit', t >= 14.4 && t < 19.8);
    v.chips[2]!.classList.toggle('lit', t >= 23.3);
    // player
    put(v.fill, '--vp', (t / T).toFixed(3));
    setText(v.time, fmtTime(t));
    let ch = CHAPTERS[0]![1];
    for (const [at, name] of CHAPTERS) if (t >= at) ch = name;
    setText(v.chapter, ch);
    const now = String(Math.floor(t));
    if (v.track.getAttribute('aria-valuenow') !== now) v.track.setAttribute('aria-valuenow', now);
  }

  // O vídeo é desenhado num tamanho fixo e escalado para caber na tela do monitor.
  function fitVideo() {
    const w = mScreen.clientWidth;
    const compact = w < 520;
    vid.classList.toggle('compact', compact);
    vid.style.setProperty('--vs', (w / (compact ? 560 : 1000)).toFixed(4));
    lineKey = '';
    pointCache.clear();
  }

  if (CAPTURE) {
    // modo de captura: nada anda sozinho. A tela sai do monitor (sem as escalas e o 3D dele) e vai para o
    // canto da página; quem captura escolhe a versão e chama step(ms) quadro a quadro. As animações e
    // transições de CSS ficam pausadas e andam junto, exatamente ms por quadro.
    document.body.appendChild(vid);
    vid.classList.add('capturing');
    const owned = new WeakSet<Animation>();
    const tickAnims = (ms: number) => {
      for (const a of document.getAnimations()) {
        if (!owned.has(a)) {
          owned.add(a);
          a.pause();
          continue; // nasceu neste quadro: começa do zero, como no navegador
        }
        a.currentTime = (Number(a.currentTime) || 0) + ms;
      }
    };
    let ct = 0;
    const w = window as unknown as { __demoCapture?: unknown };
    w.__demoCapture = {
      duration: T,
      ready: document.fonts.ready,
      setCompact(compact: boolean) {
        vid.classList.toggle('compact', compact);
        lineKey = '';
        pointCache.clear();
        ct = 0;
        render(0);
        return { w: vid.offsetWidth, h: vid.offsetHeight };
      },
      step(ms: number) {
        ct += ms / 1000;
        render(ct % T);
        tickAnims(ms);
        return { t: ct };
      },
    };
    render(0);
    return () => {};
  }

  let vt = reduce ? 14.8 : 0;
  let playing = !reduce;
  let running = false;
  let visible = false;
  let last = 0;
  let raf = 0;
  let stageTop = 0;
  // o monitor só se mexe na entrada (rolagem): chega inclinado e endireita; depois fica fixo (não segue o mouse)
  const tilt = { rx: 26, ty: 40, ms: 0.86, e: 0 };

  function stageTargets() {
    const vh = window.innerHeight;
    const e = reduce ? 1 : clamp((vh - (stageTop - window.scrollY)) / (vh * 0.85));
    return { e, rx: (1 - e) * 26, ty: (1 - e) * 50, ms: 0.84 + e * 0.16 };
  }
  // O vídeo só anda com o monitor já reto. Enquanto ele entra inclinado, a tela fica parada no primeiro quadro:
  // assim a GPU só reposiciona uma imagem pronta, em vez de redesenhar a tela inclinada a cada quadro.
  let monitorFlat = false;
  function applyTilt(dt: number, g: typeof tilt) {
    const k = reduce ? 1 : Math.min(1, dt * 7);
    for (const key of ['rx', 'ty', 'ms', 'e'] as const) tilt[key] += (g[key] - tilt[key]) * k;
    // inclinação de entrada numa camada só; reto = sem transform nenhum
    const flat = tilt.rx < 0.05 && tilt.ty < 0.3 && tilt.ms > 0.9995;
    monitorFlat = flat;
    monitor.classList.toggle('flat', flat);
    put(monitor, 'transform', flat ? 'none' : `perspective(1800px) translateY(${tilt.ty.toFixed(1)}px) rotateX(${tilt.rx.toFixed(2)}deg) scale(${tilt.ms.toFixed(4)})`);
    const e = tilt.e.toFixed(2);
    for (const chip of v.chips) put(chip, '--e', e);
    put(v.stageBg, '--e', e);
  }
  function loop(now: number) {
    if (!running) return;
    // o carimbo do rAF pode ser um pouco anterior ao performance.now() guardado ao ligar o laço
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    if (playing && monitorFlat) vt = (vt + dt) % T;
    const g = stageTargets();
    render(vt);
    applyTilt(dt, g);
    raf = requestAnimationFrame(loop);
  }
  function setRunning(should: boolean) {
    if (should === running) return;
    running = should;
    if (running) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }
  function setPlaying(p: boolean) {
    playing = p;
    v.play.classList.toggle('paused', !p);
    v.play.setAttribute('aria-label', p ? 'Pausar a demo' : 'Reproduzir a demo');
  }

  // marcas dos capítulos na barra (a posição vai em --at, aplicada aqui: a landing sai em HTML sem style inline)
  v.track.querySelectorAll<HTMLElement>('.vid-tick').forEach((tick) => tick.style.setProperty('--at', tick.dataset.at ?? '0'));
  fitVideo();
  const ro = new ResizeObserver(fitVideo);
  ro.observe(mScreen);
  offs.push(() => ro.disconnect());
  // depois das fontes, as posições do texto digitado mudam
  document.fonts?.ready.then(() => {
    lineKey = '';
    pointCache.clear();
  });
  setPlaying(playing);
  render(vt);
  offs.push(
    addScrollJob({
      measure() {
        stageTop = stage.getBoundingClientRect().top + window.scrollY;
      },
      frame() {},
    })
  );
  stageTop = stage.getBoundingClientRect().top + window.scrollY;
  applyTilt(1, stageTargets());

  const onPlay = () => setPlaying(!playing);
  v.play.addEventListener('click', onPlay);
  offs.push(() => v.play.removeEventListener('click', onPlay));
  // arrastar/clicar na barra leva a demo para aquele instante
  const seek = (e: PointerEvent) => {
    const r = v.track.getBoundingClientRect();
    vt = clamp((e.clientX - r.left) / r.width) * (T - 0.01);
    render(vt);
  };
  const onDown = (e: PointerEvent) => {
    v.track.setPointerCapture(e.pointerId);
    seek(e);
    const up = () => {
      v.track.removeEventListener('pointermove', seek);
      v.track.removeEventListener('pointerup', up);
    };
    v.track.addEventListener('pointermove', seek);
    v.track.addEventListener('pointerup', up);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      vt = clamp(vt + (e.key === 'ArrowRight' ? 2 : -2), 0, T - 0.01);
      render(vt);
      e.preventDefault();
    } else if (e.key === ' ' || e.key === 'Enter') {
      setPlaying(!playing);
      e.preventDefault();
    }
  };
  v.track.addEventListener('pointerdown', onDown);
  v.track.addEventListener('keydown', onKey);
  offs.push(() => {
    v.track.removeEventListener('pointerdown', onDown);
    v.track.removeEventListener('keydown', onKey);
  });

  // só anima quando a demo está na tela e a aba está visível; na primeira vez, começa do zero
  let started = reduce;
  // observa o próprio monitor (a seção começa colada no topo e "estaria visível" desde o carregamento)
  const visIo = new IntersectionObserver((entries) => {
    visible = entries[0]!.isIntersecting;
    setRunning(visible && !document.hidden);
  });
  visIo.observe(stage);
  const startIo = new IntersectionObserver(
    (entries) => {
      if (started || !entries[0]!.isIntersecting) return;
      started = true;
      vt = 0;
    },
    { threshold: 0.35 }
  );
  startIo.observe(stage);
  const onVisibility = () => setRunning(visible && !document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  offs.push(() => {
    visIo.disconnect();
    startIo.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    setRunning(false);
  });

  return () => offs.forEach((off) => off());
}

/**
 * A demo em produção (decisão 0051): a tela é o vídeo pré-renderizado. Mesma entrada do monitor (chega
 * inclinado com a rolagem e endireita) e mesmo player; o vídeo só baixa quando a seção chega perto da tela
 * e só toca com o monitor reto, visível e com a aba aberta. As bolhas e o player leem o tempo do vídeo.
 */
function startVideo(stage: HTMLElement, controls: HTMLElement): () => void {
  const reduce = reduceMotion();
  const $ = <E extends Element = HTMLElement>(id: string) => (stage.querySelector<E>('#' + id) ?? controls.querySelector<E>('#' + id))!;
  const video = $<HTMLVideoElement>('vidVideo');
  const mScreen = $('mScreen');
  const monitor = $('monitor');
  const play = $('vidPlay');
  const track = $('vidTrack');
  const fill = $('vidFill');
  const chapter = $('vidChapter');
  const time = $('vidTime');
  const chips = [$('chipA'), $('chipB'), $('chipC')];
  const stageBg = stage.querySelector<HTMLElement>('.stage-bg')!;
  const offs: (() => void)[] = [];
  video.muted = true; // o React não garante o atributo muted no HTML pré-renderizado, e sem ele não há autoplay

  // a versão pela largura da tela do monitor (a mesma regra de quando a tela era HTML)
  let variant: keyof typeof VARIANT | null = null;
  let loaded = false;
  const pickVariant = (): keyof typeof VARIANT => (mScreen.clientWidth < 520 ? 'compact' : 'wide');
  function useVariant(next: keyof typeof VARIANT) {
    if (next === variant) return;
    const at = video.currentTime;
    variant = next;
    video.poster = `/video/${VARIANT[next]}-poster.webp`;
    if (!loaded) return; // ainda não baixou nada: troca só o poster
    video.replaceChildren(
      ...SOURCES(VARIANT[next]).map(({ src, type }) => {
        const el = document.createElement('source');
        el.src = src;
        el.type = type;
        return el;
      })
    );
    video.load();
    if (at) video.addEventListener('loadedmetadata', () => (video.currentTime = at), { once: true });
  }
  function load() {
    if (loaded) return;
    loaded = true;
    const v = variant ?? pickVariant();
    variant = null;
    useVariant(v);
    if (reduce) video.addEventListener('loadedmetadata', () => (video.currentTime = 14.8), { once: true });
  }
  useVariant(pickVariant());
  const ro = new ResizeObserver(() => useVariant(pickVariant()));
  ro.observe(mScreen);
  offs.push(() => ro.disconnect());

  // o player e as bolhas de vidro seguem o tempo do vídeo
  function chrome(t: number) {
    put(fill, '--vp', (t / T).toFixed(3));
    const label = fmtTime(t);
    if (time.textContent !== label) time.textContent = label;
    let ch = CHAPTERS[0]![1];
    for (const [at, name] of CHAPTERS) if (t >= at) ch = name;
    if (chapter.textContent !== ch) chapter.textContent = ch;
    const now = String(Math.floor(t));
    if (track.getAttribute('aria-valuenow') !== now) track.setAttribute('aria-valuenow', now);
    chips[0]!.classList.toggle('lit', t >= 4.5 && t < 11.2);
    chips[1]!.classList.toggle('lit', t >= 14.4 && t < 19.8);
    chips[2]!.classList.toggle('lit', t >= 23.3);
  }

  let playing = !reduce;
  let running = false;
  let visible = false;
  let last = 0;
  let raf = 0;
  let stageTop = 0;
  let monitorFlat = false;
  const tilt = { rx: 26, ty: 40, ms: 0.86, e: 0 };
  function stageTargets() {
    const vh = window.innerHeight;
    const e = reduce ? 1 : clamp((vh - (stageTop - window.scrollY)) / (vh * 0.85));
    return { e, rx: (1 - e) * 26, ty: (1 - e) * 50, ms: 0.84 + e * 0.16 };
  }
  function applyTilt(dt: number, g: ReturnType<typeof stageTargets>) {
    const k = reduce ? 1 : Math.min(1, dt * 7);
    for (const key of ['rx', 'ty', 'ms', 'e'] as const) tilt[key] += (g[key] - tilt[key]) * k;
    const flat = tilt.rx < 0.05 && tilt.ty < 0.3 && tilt.ms > 0.9995;
    monitorFlat = flat;
    monitor.classList.toggle('flat', flat);
    put(monitor, 'transform', flat ? 'none' : `perspective(1800px) translateY(${tilt.ty.toFixed(1)}px) rotateX(${tilt.rx.toFixed(2)}deg) scale(${tilt.ms.toFixed(4)})`);
    const e = tilt.e.toFixed(2);
    for (const chip of chips) put(chip, '--e', e);
    put(stageBg, '--e', e);
  }
  // toca só com o monitor reto (enquanto ele entra inclinado, a tela fica no primeiro quadro)
  function syncPlayback() {
    const should = running && playing && monitorFlat && loaded;
    if (should && video.paused) void video.play().catch(() => {});
    else if (!should && !video.paused) video.pause();
  }
  function loop(now: number) {
    if (!running) return;
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    applyTilt(dt, stageTargets());
    syncPlayback();
    chrome(video.currentTime || 0);
    raf = requestAnimationFrame(loop);
  }
  function setRunning(should: boolean) {
    if (should === running) return;
    running = should;
    if (running) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(raf);
      syncPlayback();
    }
  }
  function setPlaying(p: boolean) {
    playing = p;
    play.classList.toggle('paused', !p);
    play.setAttribute('aria-label', p ? 'Pausar a demo' : 'Reproduzir a demo');
    if (p && visible) load();
    syncPlayback();
  }

  track.querySelectorAll<HTMLElement>('.vid-tick').forEach((tick) => tick.style.setProperty('--at', tick.dataset.at ?? '0'));
  setPlaying(playing);
  chrome(reduce ? 14.8 : 0);
  offs.push(
    addScrollJob({
      measure() {
        stageTop = stage.getBoundingClientRect().top + window.scrollY;
      },
      frame() {},
    })
  );
  stageTop = stage.getBoundingClientRect().top + window.scrollY;
  applyTilt(1, stageTargets());

  const onPlay = () => {
    load();
    setPlaying(!playing);
  };
  play.addEventListener('click', onPlay);
  offs.push(() => play.removeEventListener('click', onPlay));
  const seekTo = (t: number) => {
    load();
    const d = video.duration || T;
    video.currentTime = clamp(t, 0, d - 0.01);
    chrome(video.currentTime);
  };
  const seek = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    seekTo(clamp((e.clientX - r.left) / r.width) * T);
  };
  const onDown = (e: PointerEvent) => {
    track.setPointerCapture(e.pointerId);
    seek(e);
    const up = () => {
      track.removeEventListener('pointermove', seek);
      track.removeEventListener('pointerup', up);
    };
    track.addEventListener('pointermove', seek);
    track.addEventListener('pointerup', up);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      seekTo((video.currentTime || 0) + (e.key === 'ArrowRight' ? 2 : -2));
      e.preventDefault();
    } else if (e.key === ' ' || e.key === 'Enter') {
      onPlay();
      e.preventDefault();
    }
  };
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('keydown', onKey);
  offs.push(() => {
    track.removeEventListener('pointerdown', onDown);
    track.removeEventListener('keydown', onKey);
  });

  // baixa o vídeo quando a seção chega perto da tela; anima só com ela visível e a aba aberta
  const nearIo = new IntersectionObserver((entries) => entries[0]!.isIntersecting && load(), { rootMargin: '600px 0px' });
  nearIo.observe(stage);
  const visIo = new IntersectionObserver((entries) => {
    visible = entries[0]!.isIntersecting;
    setRunning(visible && !document.hidden);
  });
  visIo.observe(stage);
  // na primeira vez que a demo aparece de verdade, começa do zero
  let started = reduce;
  const startIo = new IntersectionObserver(
    (entries) => {
      if (started || !entries[0]!.isIntersecting) return;
      started = true;
      if (video.readyState > 0) video.currentTime = 0;
    },
    { threshold: 0.35 }
  );
  startIo.observe(stage);
  const onVisibility = () => setRunning(visible && !document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  offs.push(() => {
    nearIo.disconnect();
    visIo.disconnect();
    startIo.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    setRunning(false);
    video.pause();
  });

  return () => offs.forEach((off) => off());
}

export function Demo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => (CAPTURE ? startDemo : startVideo)(stageRef.current!, controlsRef.current!), []);

  return (
    <section className="demo" id="demo" aria-labelledby="demoTitle" data-pause>
      <div className="section-head center">
        <SplitTitle id="demoTitle" accent="correção," text="Do aviso à correção, no ambiente de produção." />
        <Lede>Verificações constantes durante a escrita, verifica por problemas escondidos e cria a correção certa para a situação. </Lede>
      </div>

      <div className="monitor-stage" id="monitorStage" ref={stageRef}>
        <div className="stage-bg" aria-hidden="true">
          <span className="tex-move" />
        </div>
        <div className="monitor" id="monitor">
          <div className="m-face">
            <div className="m-screen" id="mScreen">
              {CAPTURE ? (
              <div className="vid" id="vid" aria-hidden="true">
                <div className="v-title">
                  <i />
                  <i />
                  <i />
                  <span>pedidos — services/pricing/handlers.ts</span>
                </div>
                <div className="v-body">
                  <div className="v-activity">
                    <b className="on" />
                    <b />
                    <b />
                    <b className="v-shield" />
                  </div>
                  <aside className="v-side">
                    <p className="v-side-h">Protetor de código</p>
                    <div className="v-tiles">
                      <div className="v-tile" id="vTile">
                        <b id="vCount">0</b>
                        <span>Importante</span>
                        <i className="sq" />
                      </div>
                      <div className="v-tile">
                        <b>0</b>
                        <span>Atenção</span>
                        <i className="tri" />
                      </div>
                      <div className="v-tile">
                        <b>0</b>
                        <span>Leve</span>
                        <i className="dot" />
                      </div>
                    </div>
                    <p className="v-side-l">Problemas</p>
                    <p className="v-empty" id="vEmpty">
                      <span className="check" />
                      Nenhum problema neste repositório.
                    </p>
                    <div className="v-row" id="vRow">
                      <i className="sq" />
                      <div>
                        <strong>handlers.ts</strong>
                        <span>services/pricing</span>
                      </div>
                      <em>1</em>
                    </div>
                    <div className="v-row-f" id="vRowF">
                      <strong>Escrita dupla em "total"</strong>
                      <span>#1 linha 5 · com tax/handlers.ts</span>
                    </div>
                  </aside>
                  <div className="v-editor">
                    <div className="v-tabs">
                      <span className="on">handlers.ts</span>
                      <span>tax/handlers.ts</span>
                    </div>
                    <div className="v-code">
                      <div className="v-ln">
                        <i>1</i>
                        <span>
                          <b className="k">import</b>
                          {' { bus } '}
                          <b className="k">from</b> <b className="s">'../bus'</b>;
                        </span>
                      </div>
                      <div className="v-ln">
                        <i>2</i>
                        <span />
                      </div>
                      <div className="v-ln">
                        <i>3</i>
                        <span>
                          <b className="c">{'// desconto de fidelidade'}</b>
                        </span>
                      </div>
                      <div className="v-ln">
                        <i>4</i>
                        <span>
                          bus.on(<b className="s">'order.updated'</b>
                          {', (order) => {'}
                        </span>
                      </div>
                      <div className="v-ln v-target" id="vLine">
                        <i>5</i>
                        <span>
                          {'  '}
                          <span id="vTyped" />
                          <span className="v-caret" id="vCaret" />
                        </span>
                        <u className="v-gut" />
                      </div>
                      <div className="v-ln">
                        <i>6</i>
                        <span>{'});'}</span>
                      </div>
                    </div>
                    <div className="v-hover" id="vHover">
                      <p className="v-hover-h">
                        <span className="sq" />
                        <strong>Importante</strong>
                        <span>#1, linha 5</span>
                      </p>
                      <p>Escrita dupla em "total" no evento order.updated.</p>
                      <p className="v-hover-l">Outro lado: services/tax/handlers.ts, linha 5</p>
                      <pre>order.total = order.subtotal * 1.1;</pre>
                    </div>
                    <div className="v-term" id="vTerm">
                      <p className="v-term-h">Terminal</p>
                      <pre>
                        <span className="prompt">$</span> <span id="vCmd" />
                        <span className="v-caret on" id="vCmdCaret" />
                        {'\n'}
                        <span className="v-out" id="vOut1">
                          📋 4 regra(s) lida(s) de services
                        </span>
                        {'\n'}
                        <span className="v-out ok" id="vOut2">
                          ✅ nenhuma colisão detectada.
                        </span>
                      </pre>
                    </div>
                  </div>
                  <aside className="v-chat" id="vChat">
                    <p className="v-chat-h">
                      <span className="v-dot" />
                      Chat do ShielDepy
                    </p>
                    <p className="v-msg me" id="vMsg1">
                      Como resolvo essa colisão?
                    </p>
                    <p className="v-typing" id="vTyping">
                      <i />
                      <i />
                      <i />
                    </p>
                    <div className="v-msg bot" id="vMsg2">
                      <p>
                        Deixe só o imposto gravando <code>total</code>. Aqui, grave o desconto em <code>discount</code>.
                      </p>
                      <p className="v-ok" id="vOk">
                        <span className="check" />
                        Testado numa cópia do grafo: nenhuma colisão nova, nenhum ciclo.
                      </p>
                      <span className="v-apply" id="vApply">
                        <span>Aplicar correção</span>
                        <span>Aplicada</span>
                      </span>
                    </div>
                  </aside>
                </div>
                <div className="v-status">
                  <span>⎇ main</span>
                  <span className="v-st" id="vStatus">
                    <i />
                    <em id="vStatusText">ShielDepy: protegido</em>
                  </span>
                </div>
                <div className="v-toast" id="vToast">
                  <span className="check" />
                  <div>
                    <strong>Nenhuma colisão</strong>
                    <span>Correção aplicada em handlers.ts</span>
                  </div>
                </div>
                <svg className="v-cursor" id="vCursor" viewBox="0 0 24 24">
                  <path d="M5 2.5 19.5 11l-6.4 1.7L10 19.4z" />
                </svg>
                <span className="v-click" id="vClick" />
                <div className="v-fade" id="vFade" />
              </div>
              ) : (
                <video className="vid-video" id="vidVideo" muted loop playsInline preload="none" poster={`/video/${VARIANT.wide}-poster.webp`} aria-hidden="true" />
              )}
              <div className="screen-glare" />
            </div>
          </div>
          <div className="m-stand">
            <span className="m-neck" />
            <span className="m-foot" />
          </div>
        </div>
        <div className="m-floor" aria-hidden="true" />

        <p className="float-chip lg" data-lg="chip" id="chipA" aria-hidden="true">
          <span className="sq" />
          Colisão provada
        </p>
        <p className="float-chip lg" data-lg="chip" id="chipB" aria-hidden="true">
          <span className="check" />
          Correção verificada
        </p>
        <p className="float-chip lg" data-lg="chip" id="chipC" aria-hidden="true">
          <span className="chip-code">saída 0</span>
          Merge liberado
        </p>
      </div>

      <div className="vid-controls glass lg" data-lg="controls" id="vidControls" ref={controlsRef}>
        <button type="button" className="vid-play" id="vidPlay" aria-label="Pausar a demo">
          <span />
        </button>
        <div className="vid-track" id="vidTrack" role="slider" tabIndex={0} aria-label="Posição da demo" aria-valuemin={0} aria-valuemax={26} aria-valuenow={0}>
          <span className="vid-fill" id="vidFill" />
          {CHAPTERS.slice(1).map(([at]) => (
            <i key={at} className="vid-tick" data-at={(at / T).toFixed(4)} />
          ))}
        </div>
        <span className="vid-chapter" id="vidChapter">
          Digitando
        </span>
        <span className="vid-time" id="vidTime">
          0:00
        </span>
      </div>
    </section>
  );
}
