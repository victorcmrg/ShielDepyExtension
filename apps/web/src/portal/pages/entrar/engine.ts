// O motor da encenação do "Entrar" (decisão 0039): um requestAnimationFrame que, a cada quadro,
// pergunta ao roteiro (script.ts) e à física (physics.ts) onde está cada coisa e escreve só
// transform, opacity e classes. Nada de React por quadro: a página monta a cena uma vez e este
// arquivo a anima. O relógio anda no máximo 50 ms por quadro: com a aba escondida, a cena pausa em
// vez de pular.
//
// Por cima do roteiro, um pouco de física nos cursores: um balanço leve quando estão soltos, a
// inclinação para o lado em que andam e o esbarrão quando dois se cruzam na mesma profundidade (eles
// se empurram, piscam e soltam faíscas).
//
// A cena tem perspectiva de verdade: a câmera inclina o plano em 3D, e cursores, balões e peças
// levantadas saem do plano (translateZ) e projetam a sombra nele. Para o que está fora do plano
// continuar onde o roteiro manda na tela, a posição é dividida pelo aumento da perspectiva.
import { kickAround, makeBody, rng, stepBody, type Body } from './physics';
import * as S from './script';
import { createSfx, step, THUDS, tone, type SfxName, type PlayOpts } from './sfx';

type Pt = { x: number; y: number };

interface Pop {
  el: HTMLElement;
  w: number;
  h: number;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  vr: number;
  mode: 'idle' | 'held' | 'fly' | 'gone';
  gx: number;
  gy: number;
  phase: number;
  /** quanto saiu do plano (px), levantado pelo cursor */
  z: number;
  sh: HTMLElement;
  // velocidade na tela (para esticar na direção do movimento) e a gelatina (mola de escala)
  lx: number;
  ly: number;
  svx: number;
  svy: number;
  jig: number;
  vjig: number;
  // pêndulo (pego pelo canto): ângulo a partir da vertical, velocidade, comprimento e giro de partida
  al: number;
  val: number;
  al0: number;
  len: number;
  rot0: number;
  pvx: number;
  pvy: number;
  ty: number;
}

/** Uma peça que um cursor leva de um lugar errado para o certo. */
interface Carry {
  el: HTMLElement;
  cur: number;
  iv: S.Interval;
  w: number;
  h: number;
  x: number;
  y: number;
  rot: number;
  sc: number;
  z: number;
  sh: HTMLElement;
  target: Pt & { rot: number };
  state: 'idle' | 'held' | 'settle' | 'placed';
  gx: number;
  gy: number;
  gz: number;
  from: { x: number; y: number; rot: number; sc: number; t: number };
}

interface Cursor {
  id: S.CursorId;
  el: HTMLElement;
  sh: HTMLElement;
  eyes: SVGGElement;
  svg: SVGSVGElement;
  eyesIn: SVGGElement;
  prev: Pt | null;
  v: Pt;
  tip: Pt;
  z: number;
  sc: number;
  on: boolean;
  pressed: boolean;
  pressedBefore: boolean;
  // desvio do trajeto (esbarrões), com mola
  ox: number;
  oy: number;
  vox: number;
  voy: number;
  tilt: number;
  bonkUntil: number;
  phase: number;
  thinking: boolean;
  tapping: boolean;
  scr: Pt;
  looks?: { t: number; x: number; y: number }[];
}

export function runEntrar(root: HTMLElement, done: () => void): () => void {
  // no `npm run web:dev`, window.__entrarSeek(ms) pausa a cena e a leva ao instante pedido (para
  // conferir quadros sem esperar, mesmo com a aba escondida); no build o Vite troca DEV por false
  const dev = import.meta.env.DEV;
  // ?capture (só no web:dev): a cena não anda sozinha; quem captura o vídeo chama
  // window.__entrarCapture.step(ms) quadro a quadro (decisão 0043). Os sons não tocam: viram marcações
  // com o tempo exato (__entrarCues), que depois viram a trilha do vídeo.
  const capture = dev && new URLSearchParams(location.search).has('capture');
  const cues: { t: number; name: SfxName; o?: PlayOpts }[] = [];
  const woodCues: [number, number][] = [];
  const dbg = window as unknown as { __entrarProject?: (x: number, y: number, z: number) => Pt };
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const $$ = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rand = rng(404);
  // os sons (baixinhos), ligados por padrão (decisão 0041). Vindo do "Entrar" da landing, o clique
  // já liberou o áudio. Num reload (ou abrindo o link direto) o navegador bloqueia o som até a primeira
  // interação: aí o primeiro clique, toque ou tecla só liga o som, e a animação segue (pular fica para o
  // seguinte). Esc não libera áudio no navegador, então continua pulando.
  const sfx = createSfx();
  let quiet = false; // o gancho de desenvolvimento avança a cena sem tocar nada
  const snd = (name: SfxName, o?: PlayOpts) => {
    if (capture) cues.push({ t, name, o });
    else if (!quiet) sfx.play(name, o);
  };
  const wood = capture
    ? {
        set: (g: number) => {
          const lastG = woodCues.length ? woodCues[woodCues.length - 1]![1] : 0;
          if (Math.abs(g - lastG) >= 0.005) woodCues.push([t, +g.toFixed(3)]);
        },
        stop: () => {},
      }
    : sfx.loop('wood-drag');
  let unlockedByGesture = false;
  const onGesture = (e: Event) => {
    if (!sfx.blocked || unlockedByGesture) return;
    if (e instanceof KeyboardEvent && e.key === 'Escape') return;
    // o toque no celular só libera o áudio ao soltar (pointerup/touchend): o pointerdown já é engolido aqui
    if (e.type === 'pointerdown' || e.type === 'keydown') e.stopImmediatePropagation();
    void sfx.unlock().then((ok) => {
      if (ok) unlockedByGesture = true;
    });
    if (e.type === 'pointerup' || e.type === 'touchend' || e.type === 'keydown') unlockedByGesture = true;
  };
  const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  GESTURES.forEach((g) => window.addEventListener(g, onGesture, true));
  let lastHum = -1e9;
  let popN = 0; // cada bot criado faz o "pop" um passo acima do anterior
  // o 404 em 3D de verdade e o confete do fim usam three.js, num pedaço à parte (decisão 0040); se não
  // carregar a tempo ou não houver WebGL, as letras seguem no 3D em CSS
  let glMod: typeof import('./letters3d') | null = null;
  let gl: import('./letters3d').Letters3D | null = null;
  const glReady = import('./letters3d')
    .then((m) => {
      glMod = m;
    })
    .catch(() => {});

  // escreve só quando muda (estilo é caro mesmo quando o valor é o mesmo)
  const last = new WeakMap<HTMLElement, Record<string, string>>();
  const put = (el: HTMLElement, prop: 'transform' | 'opacity' | 'width' | 'height' | 'zIndex', v: string) => {
    let m = last.get(el);
    if (!m) last.set(el, (m = {}));
    if (m[prop] === v) return;
    m[prop] = v;
    el.style[prop] = v;
  };
  const flag = (el: Element, cls: string, on: boolean) => {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  };
  const at = (x: number, y: number, extra = '', z = 0) => `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px)${extra}`;
  // camadas do mesmo plano: um fio de profundidade decide quem fica por cima (z-index não vale em 3D)
  const Z = { slot: 0.4, box: 0, content: 1, seed: 2, shadow: 2.5, pop: 3, popBehind: 2, popShadow: 0.8, curShadow: 3.6, palette: 4, ripple: 5, spark: 6 } as const;
  let cam3 = { s: 1, fx: 0, fy: 0, rx: 0, ry: 0 };
  let cosX = 1;
  let sinX = 0;
  let cosY = 1;
  let sinY = 0;
  /** Onde um ponto do mundo (relativo ao centro, z acima do plano) cai na tela: a mesma conta do navegador
   *  para "rotateX rotateY scale translate" na câmera e a perspectiva da cena. */
  const projectWith = (c: { s: number; fx: number; fy: number; rx: number; ry: number }, X: number, Y: number, Zw: number): Pt => {
    const cx = Math.cos((c.rx * Math.PI) / 180);
    const sx = Math.sin((c.rx * Math.PI) / 180);
    const cy = Math.cos((c.ry * Math.PI) / 180);
    const sy = Math.sin((c.ry * Math.PI) / 180);
    const x0 = (X - c.fx) * c.s;
    const y0 = (Y - c.fy) * c.s;
    const x1 = x0 * cy + Zw * sy;
    const z1 = -x0 * sy + Zw * cy;
    const y2 = y0 * cx - z1 * sx;
    const z2 = y0 * sx + z1 * cx;
    const k = S.PERSPECTIVE / (S.PERSPECTIVE - z2);
    return { x: x1 * k, y: y2 * k };
  };
  const project = (X: number, Y: number, Zw: number): Pt => {
    const x0 = (X - cam3.fx) * cam3.s;
    const y0 = (Y - cam3.fy) * cam3.s;
    // rotateY
    const x1 = x0 * cosY + Zw * sinY;
    const z1 = -x0 * sinY + Zw * cosY;
    // rotateX
    const y2 = y0 * cosX - z1 * sinX;
    const z2 = y0 * sinX + z1 * cosX;
    const k = S.PERSPECTIVE / (S.PERSPECTIVE - z2);
    return { x: x1 * k, y: y2 * k };
  };
  /** O ponto do plano que aparece na tela em (sx, sy) com a câmera de agora. */
  const unproject = (sx: number, sy: number): Pt => {
    let X = sx / cam3.s + cam3.fx;
    let Y = sy / cam3.s + cam3.fy;
    for (let i = 0; i < 4; i++) {
      const p = project(X, Y, 0);
      const ex = p.x - sx;
      const ey = p.y - sy;
      if (Math.abs(ex) + Math.abs(ey) < 0.05) break;
      const px = project(X + 1, Y, 0);
      const py = project(X, Y + 1, 0);
      const a11 = px.x - p.x;
      const a21 = px.y - p.y;
      const a12 = py.x - p.x;
      const a22 = py.y - p.y;
      const det = a11 * a22 - a12 * a21 || 1;
      X -= (ex * a22 - ey * a12) / det;
      Y -= (ey * a11 - ex * a21) / det;
    }
    return { x: X, y: Y };
  };
  /** O contrário da câmera: o que vier depois disto fica preso na tela (o DevTools), mas ainda no 3D. */
  const uncam = () =>
    `translate3d(${cam3.fx.toFixed(2)}px, ${cam3.fy.toFixed(2)}px, 0) scale(${(1 / cam3.s).toFixed(5)}) rotateY(${(-cam3.ry).toFixed(3)}deg) rotateX(${(-cam3.rx).toFixed(3)}deg)`;
  /** Onde pôr no mundo algo que está zPx acima do plano para ele aparecer, na tela, em cima do ponto
   *  (x, y) do plano (Gauss-Newton em 2 variáveis: converge em 2 ou 3 passos). */
  const lifted = (x: number, y: number, zPx: number): Pt => {
    if (Math.abs(zPx) < 0.5) return { x, y };
    const want = project(x, y, 0);
    let X = x;
    let Y = y;
    for (let i = 0; i < 4; i++) {
      const p = project(X, Y, zPx);
      const ex = p.x - want.x;
      const ey = p.y - want.y;
      if (Math.abs(ex) + Math.abs(ey) < 0.05) break;
      const px = project(X + 1, Y, zPx);
      const py = project(X, Y + 1, zPx);
      const a11 = px.x - p.x;
      const a21 = px.y - p.y;
      const a12 = py.x - p.x;
      const a22 = py.y - p.y;
      const det = a11 * a22 - a12 * a21 || 1;
      X -= (ex * a22 - ey * a12) / det;
      Y -= (ey * a11 - ex * a21) / det;
    }
    return { x: X, y: Y };
  };
  /** Olho de peixe invertido: perto da borda, a coisa cresce e é puxada para fora (o cursor perto da
   *  câmera fica de fora: ele está "na frente da lente"). */
  const lensOf = (x: number, y: number, zPx: number) => {
    if (zPx > 200) return '';
    const sp = project(x, y, zPx);
    const l = S.lens(sp.x, sp.y, vw, vh);
    if (l.k === 1) return '';
    return ` translate(${l.dx.toFixed(1)}px, ${l.dy.toFixed(1)}px) scale(${l.k.toFixed(3)})`;
  };
  /** Esticar na direção do movimento e afinar na outra (squash & stretch): peças maleáveis. */
  const stretch = (vx: number, vy: number, max: number) => {
    const sp = Math.hypot(vx, vy);
    if (sp < 40) return '';
    const k = 1 + Math.min(max, sp / 3200);
    const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
    return ` rotate(${ang.toFixed(1)}deg) scale(${k.toFixed(3)}, ${(1 / k).toFixed(3)}) rotate(${(-ang).toFixed(1)}deg)`;
  };
  const rel = (el: Element): S.Rect => {
    const r = el.getBoundingClientRect();
    return { l: r.left - vw / 2, t: r.top - vh / 2, r: r.right - vw / 2, b: r.bottom - vh / 2 };
  };

  const cam = $('.ent-cam');
  let camKeys = S.introCamera(vw, vh);
  let camS = 1;

  // ---------------- as peças que caem ----------------
  const glyphs = $$('.ent-g');
  const shadows = $$('.ent-sh');
  const floor = vh / 2 - 14;
  let bodies: Body[] = [];
  const lastHit: number[] = [];
  let lastThud = -1e9;
  const origin: Pt[] = [];
  const digitPlan = [
    { start: S.T.FALL_4A, tip: -90, yaw: 6, kick: -90 },
    { start: S.T.FALL_0, tip: 90, yaw: -2, kick: 40 },
    { start: S.T.FALL_4B, tip: 90, yaw: -7, kick: 120 },
  ];
  function setupBodies() {
    bodies = glyphs.map((g, i) => {
      const r = rel(g);
      const w = r.r - r.l;
      const h = r.b - r.t;
      const x = (r.l + r.r) / 2;
      origin[i] = { x, y: r.b };
      shadows[i]!.style.width = `${(w * 1.3).toFixed(0)}px`;
      if (g.dataset.kind === 'digit') {
        const d = digitPlan[i] ?? digitPlan[1]!;
        return makeBody(x, r.b, w, h, { start: d.start, rest: 0.2, kick: d.kick, tipTarget: d.tip, yawTarget: d.yaw, vspin: (rand() - 0.5) * 40 });
      }
      const side = rand() < 0.65 ? 1 : -1;
      return makeBody(x, r.b, w, h, {
        start: S.T.FALL_TEXT + rand() * 160,
        rest: 0.3 + rand() * 0.2,
        kick: (rand() - 0.5) * 2 * (150 + rand() * 450),
        tipTarget: side * 90,
        yawTarget: (rand() - 0.5) * 16,
        vspin: (rand() - 0.5) * 300,
      });
    });
    if (glMod) {
      try {
        const list = glyphs.map((g, i) => {
          const cs = getComputedStyle(g);
          const px = parseFloat(cs.fontSize);
          return { ch: g.dataset.ch ?? g.textContent!.slice(-1), font: `${cs.fontWeight} ${px}px ${cs.fontFamily}`, px, rect: rel(g), pivot: origin[i]! };
        });
        gl = glMod.createLetters3D($('.ent-gl') as unknown as HTMLCanvasElement, list, vw, vh, floor);
        root.classList.add('is-gl');
        // o HTML do 404 sai na hora (sem depender de transição de CSS)
        $('.ent-letters').style.visibility = 'hidden';
      } catch {
        gl = null;
      }
    }
  }
  function stepBodies(t: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const b of bodies) {
        if (stepBody(b, h, t, floor, -vw / 2 + 8, vw / 2 - 8) === 'impact' && b.w > 60) kickAround(b, bodies, rand);
      }
    }
    // cada toque no chão é um balão batendo: no primeiro e nos quiques e no tombo ao deitar, cada vez
    // uma das batidas num tom da escala, mais baixo quanto mais fraco o toque (os números mais graves)
    bodies.forEach((b, i) => {
      const hit = b.hit;
      b.hit = 0;
      if (hit < 170 || t - (lastHit[i] ?? -1e9) < 90 || t - lastThud < 48) return;
      lastHit[i] = lastThud = t;
      const big = b.w > 60;
      const force = Math.min(1, (hit - 120) / 1700);
      const name = big && force > 0.6 ? 'thud-big' : THUDS[Math.floor(rand() * THUDS.length)]!;
      snd(name, { gain: (big ? 0.55 : 0.2) * (0.25 + 0.75 * force), rate: big ? tone(rand, 0.84, 2) : tone(rand, 1.02, 3) });
    });
    if (gl) {
      // a sombra do 404 entra devagar (~2,5 s), a partir de quando o 3D assumiu
      gl.frame(bodies, cam3, S.seg(t, Math.max(S.T.NOT_FOUND - 2600, glAt), S.T.NOT_FOUND - 100, S.ease.inOutSine));
      return;
    }
    bodies.forEach((b, i) => {
      const o = origin[i]!;
      const g = glyphs[i]!;
      put(g, 'transform', at(b.x - o.x, b.y - o.y, `${lensOf(b.x, b.y - b.h / 2, 0)} rotateY(${b.yaw.toFixed(1)}deg) rotateX(${b.tip.toFixed(1)}deg) rotateZ(${b.spin.toFixed(1)}deg)`));
      flag(g, 'is-3d', b.tipped);
      const sh = shadows[i]!;
      const near = b.active ? Math.max(0, 1 - (floor - b.y) / 320) : 0;
      const lying = Math.abs(Math.sin((b.tip * Math.PI) / 180));
      put(sh, 'transform', at(b.x - b.w * 0.65, floor - 7, ` scale(${(0.6 + near * 0.4).toFixed(3)}, ${(1 + lying * 1.6).toFixed(3)})`));
      put(sh, 'opacity', (near * 0.32).toFixed(3));
    });
  }

  // ---------------- os balões ----------------
  const spots = S.balloonSpots(vw, vh);
  const mkPop = (sel: string, p: Pt, sh: string): Pop => ({ el: $(sel), w: 0, h: 0, x: p.x, y: p.y, rot: 0, vx: 0, vy: 0, vr: 0, mode: 'idle', gx: 0, gy: 0, phase: rand() * 6, z: 0, sh: $(sh), lx: p.x, ly: p.y, svx: 0, svy: 0, jig: 0, vjig: 0, al: 0, val: 0, al0: 0, len: 1, rot0: 0, pvx: 0, pvy: 0, ty: 0 });
  const p0 = mkPop('.ent-pop.p0', spots.p0, '.ent-psh[data-for="p0"]');
  const p1 = mkPop('.ent-pop.p1', spots.p1, '.ent-psh[data-for="p1"]');
  const p2 = mkPop('.ent-pop.p2', spots.p2, '.ent-psh[data-for="p2"]');

  const goo = $('.ent-goo');
  const neckPath = root.querySelector<SVGPathElement>('.ent-neck path')!;
  const g0 = $('.goo.g0');
  const g1 = $('.goo.g1');
  const g2 = $('.goo.g2');
  let popsMeasured = false;
  function measurePops() {
    for (const p of [p0, p1, p2]) {
      p.w = p.el.offsetWidth;
      p.h = p.el.offsetHeight;
    }
    for (const p of [p1, p2]) {
      p.sh.style.width = `${p.w}px`;
      p.sh.style.height = `${p.h}px`;
    }
    for (const [g, p] of [
      [g0, p0],
      [g1, p1],
      [g2, p2],
    ] as const) {
      g.style.width = `${p.w}px`;
      g.style.height = `${p.h}px`;
    }
    popsMeasured = true;
  }

  // ---------------- a reconstrução (montada quando a tela final já pode ser medida) ----------------
  let L: S.Layout | null = null;
  let tracks: Record<S.CursorId, S.Track> | null = null;
  let pal: ReturnType<typeof S.palette> | null = null;
  let meet: ReturnType<typeof S.meetingPoints> | null = null;
  const cursors: Cursor[] = (['a', 'b', 'c', 'd', 'x', 'y'] as const).map((id, i) => ({
    id,
    el: $(`.ent-cur[data-id="${id}"]`),
    sh: $(`.ent-cur-sh[data-id="${id}"]`),
    eyes: root.querySelector<SVGGElement>(`.ent-cur[data-id="${id}"] .eyes`)!,
    svg: root.querySelector<SVGSVGElement>(`.ent-cur[data-id="${id}"] .ent-cur-svg`)!,
    eyesIn: root.querySelector<SVGGElement>(`.ent-cur[data-id="${id}"] .eyes-in`)!,
    prev: null,
    v: { x: 0, y: 0 },
    tip: { x: 0, y: 0 },
    z: -1,
    sc: 1,
    on: false,
    pressed: false,
    pressedBefore: false,
    ox: 0,
    oy: 0,
    vox: 0,
    voy: 0,
    tilt: 0,
    bonkUntil: 0,
    phase: i * 1.7,
    thinking: false,
    tapping: false,
    scr: { x: 0, y: 0 },
  }));
  const [A, B, C, D, X, Y] = cursors as [Cursor, Cursor, Cursor, Cursor, Cursor, Cursor];
  const lastBonk = new Map<string, number>();

  const ripples = $$('.ent-rip');
  let rippleNext = 0;
  function ripple(p: Pt) {
    snd('click', { gain: 0.3, rate: tone(rand, 0.95, 3) });
    const r = ripples[rippleNext++ % ripples.length]!;
    r.animate(
      [
        { transform: at(p.x - 20, p.y - 20, ' scale(0.3)', Z.ripple), opacity: 0.9 },
        { transform: at(p.x - 20, p.y - 20, ' scale(1.7)', Z.ripple), opacity: 0 },
      ],
      { duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
  }
  const trails = Array.from(root.querySelectorAll<SVGLineElement>('.ent-trails line'));
  let trailNext = 0;
  /** O rastro do teletransporte: um traço vermelho que corre e some. */
  function trail(a: Pt, b: Pt) {
    snd('click', { gain: 0.12, rate: tone(rand, 1.8, 2) });
    const ln = trails[trailNext++ % trails.length]!;
    ln.setAttribute('x1', (a.x + 12).toFixed(1));
    ln.setAttribute('y1', (a.y + 12).toFixed(1));
    ln.setAttribute('x2', (b.x + 12).toFixed(1));
    ln.setAttribute('y2', (b.y + 12).toFixed(1));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    ln.style.strokeDasharray = `${len.toFixed(0)} ${len.toFixed(0)}`;
    ln.animate(
      [
        { strokeDashoffset: `${len.toFixed(0)}`, opacity: 1 },
        { strokeDashoffset: '0', opacity: 1, offset: 0.35 },
        { strokeDashoffset: `${(-len).toFixed(0)}`, opacity: 0 },
      ],
      { duration: 520, easing: 'cubic-bezier(.3,.7,.2,1)' }
    );
  }
  const sparks = $$('.ent-spark');
  let sparkNext = 0;
  function burst(p: Pt, n: number, power: number) {
    for (let i = 0; i < n; i++) {
      const s = sparks[sparkNext++ % sparks.length]!;
      const ang = rand() * Math.PI * 2;
      const dist = (22 + rand() * 30) * power;
      const rot = (rand() - 0.5) * 180;
      s.animate(
        [
          { transform: at(p.x - 6, p.y - 6, ` rotate(0deg) scale(${(0.6 + rand() * 0.6).toFixed(2)})`, Z.spark), opacity: 1 },
          { transform: at(p.x - 6 + Math.cos(ang) * dist, p.y - 6 + Math.sin(ang) * dist, ` rotate(${rot.toFixed(0)}deg) scale(0.15)`, Z.spark + 40 * rand()), opacity: 0 },
        ],
        { duration: 420 + rand() * 260, easing: 'cubic-bezier(.15,.75,.25,1)' }
      );
    }
  }
  const fired = new Set<string>();
  const once = (key: string, cond: boolean) => {
    if (!cond || fired.has(key)) return false;
    fired.add(key);
    return true;
  };

  const box = $('.ent-box');
  let logoScale = 1;
  const spawnEl = $('.ent-spawner.normal');
  const spawnN = $('.ent-spawner.normal .sp-n');
  const spawnPlus = $('.ent-spawner.normal .sp-plus');
  const spawn2El = $('.ent-spawner.chaos');
  const spawn2N = $('.ent-spawner.chaos .sp-n');
  const spawn2Plus = $('.ent-spawner.chaos .sp-plus');
  let plus2Pt: Pt = { x: 0, y: 0 };
  // o mapa das ligações (X) e o DevTools (Y)
  const graphEl = $('.ent-graph');
  const graphShadow = $('.ent-psh[data-for="graph"]');
  const boxShadow = $('.ent-psh[data-for="box"]');
  const palShadow = $('.ent-psh[data-for="pal"]');
  const spnShadow = $('.ent-psh[data-for="spn"]');
  const spcShadow = $('.ent-psh[data-for="spc"]');
  const fontShadow = $('.ent-psh[data-for="fonts"]');
  const graphNodes = $$('.ent-graph .gn');
  const graphBroken = $('.ent-graph .ge.is-broken');
  const devEl = $('.ent-dev');
  const devLines = $$('.ent-dev .dl');
  const devCount = $('.ent-dev .dv-count');
  let gp: ReturnType<typeof S.graphPanel> | null = null;
  let dv: ReturnType<typeof S.devtools> | null = null;
  const tether = root.querySelector<SVGLineElement>('.ent-tether line')!;
  const tetherSvg = root.querySelector<SVGSVGElement>('.ent-tether')!;
  let plusPt: Pt = { x: 0, y: 0 };
  const gizmos = $$('.ent-gizmo');
  const mpaths = { sub: root.querySelector<SVGPathElement>('.ent-mpath .mp-sub')!, back: root.querySelector<SVGPathElement>('.ent-mpath .mp-back')! };
  const mpathSvg = root.querySelector<SVGSVGElement>('.ent-mpath')!;
  const seed = $('.ent-seed');
  const wtitle = $('.ent-wtitle');
  const wLetters = $$('.ent-wtitle .wl');
  const title = $('.ent-title');
  let shownTitle = '';
  /** O título letra a letra: cada letra nova entra com um pulinho; o apagar tira só as do fim. */
  function syncTitle(text: string) {
    if (text === shownTitle) return;
    let i = 0;
    while (i < shownTitle.length && i < text.length && shownTitle[i] === text[i]) i++;
    while (titleIn.childNodes.length > i) titleIn.lastChild!.remove();
    for (const ch of text.slice(i)) {
      const sp = document.createElement('span');
      sp.className = 'ch';
      sp.textContent = ch;
      titleIn.appendChild(sp);
    }
    shownTitle = text;
  }
  const titleIn = $('.ent-title-in');
  const fontsEl = $('.ent-fonts');
  const fontOpts = $$('.ent-fonts .fo');
  const logo = $('.ent-logo');
  const drawE = $('.ent-draw.de');
  const drawP = $('.ent-draw.dp');
  const drawB = $('.ent-draw.db');
  const fieldE = $('.ent-field.fe');
  const fieldP = $('.ent-field.fp');
  const labelE = $('.ent-label.le');
  const labelP = $('.ent-label.lp');
  const cpf = $('.ent-cpf');
  const btn = $('.ent-btn');
  const palEl = $('.ent-palette');
  const swatches = $$('.ent-palette .sw');
  const slots = $$('.ent-slot');
  const cpfState = { x: 0, y: 0, rot: 0, vy: 0, mode: 'idle' as 'idle' | 'held' | 'fly' | 'gone', gx: 0, gy: 0 };
  let carries: Carry[] = [];
  let slotDone: Record<string, number> = {};

  const placeRect = (el: HTMLElement, r: S.Rect, z: number = Z.content) => {
    el.style.width = `${(r.r - r.l).toFixed(1)}px`;
    el.style.height = `${(r.b - r.t).toFixed(1)}px`;
    put(el, 'transform', at(r.l, r.t, '', z));
  };
  const union = (a: S.Rect, b: S.Rect): S.Rect => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });

  function plan() {
    const m = (key: string) => rel(root.querySelector(`.ent-final [data-m="${key}"]`)!);
    const lay: S.Layout = {
      vw,
      vh,
      card: m('card'),
      // o logo é uma linha inteira (flex centrado): a medida é só a do ícone com o nome
      logo: Array.from(root.querySelector('.ent-final [data-m="logo"]')!.children)
        .map(rel)
        .reduce(union),
      title: m('title'),
      subtitle: m('subtitle'),
      emailLabel: m('emailLabel'),
      email: m('email'),
      passLabel: m('passLabel'),
      pass: m('pass'),
      button: m('button'),
      back: m('back'),
    };
    L = lay;
    tracks = S.cursorTracks(lay);
    // as chaves de Y que são do mundo (o nascimento) viram da tela com a câmera daquele instante
    {
      const rb0 = S.rebuildCamera(lay);
      const ck = [...S.introCamera(vw, vh).filter((k) => k.t < rb0[0]!.t), ...rb0];
      for (const key of tracks.y.keys) {
        if (key.screen) continue;
        const sp = projectWith(S.sampleCam(ck, key.t), key.x, key.y, 0);
        key.x = sp.x;
        key.y = sp.y;
        key.screen = true;
      }
    }
    // a câmera da introdução vale até onde a da reconstrução começa (ela já vai até o ponto verde)
    const rb = S.rebuildCamera(lay);
    camKeys = [...S.introCamera(vw, vh).filter((k) => k.t < rb[0]!.t), ...rb];
    pal = S.palette(lay);
    meet = S.meetingPoints(lay);
    const mis = S.misplaced(lay);
    put(palEl, 'transform', at(pal.x, pal.y, '', Z.palette));
    const fpk = S.fontPicker(lay);
    put($('.ent-fonts'), 'transform', at(fpk.x, fpk.y, '', Z.palette));
    placeRect(wtitle, lay.title);
    placeRect(title, lay.title);
    placeRect(logo, lay.logo);
    placeRect(fieldE, lay.email);
    placeRect(fieldP, lay.pass);
    placeRect(labelE, lay.emailLabel);
    placeRect(labelP, lay.passLabel);
    placeRect(btn, lay.button);
    cpf.style.width = `${lay.button.r - lay.button.l}px`;
    cpf.style.height = `${lay.button.b - lay.button.t}px`;
    cpfState.x = S.cx(lay.button);
    cpfState.y = S.cy(lay.button);
    cpfState.rot = 2;

    // as partes pontilhadas: onde cada peça vai ficar, até ela chegar
    const slotRects: Record<string, S.Rect> = {
      logo: lay.logo,
      title: lay.title,
      subtitle: lay.subtitle,
      email: union(lay.emailLabel, lay.email),
      pass: union(lay.passLabel, lay.pass),
      button: lay.button,
      back: lay.back,
    };
    for (const el of slots) {
      const r = slotRects[el.dataset.k!]!;
      placeRect(el, { l: r.l - 4, t: r.t - 3, r: r.r + 4, b: r.b + 3 }, Z.slot);
    }
    slotDone = {
      logo: S.T.LOGO[1] + 150,
      title: S.T.FONT_PICK + 200,
      subtitle: S.T.SUB[1] + 200,
      email: S.T.EMAIL[1] + 80,
      pass: S.T.PASS[1] + 80,
      button: S.T.BUTTON[1] + 80,
      back: S.T.BACK[1] + 200,
    };

    // as peças fora do lugar
    const sub = $('.ent-sub');
    const backlink = $('.ent-backlink');
    const size = (el: HTMLElement, r?: S.Rect) => {
      if (r) {
        el.style.width = `${(r.r - r.l).toFixed(1)}px`;
        el.style.height = `${(r.b - r.t).toFixed(1)}px`;
        return { w: r.r - r.l, h: r.b - r.t };
      }
      return { w: el.offsetWidth, h: el.offsetHeight };
    };
    const mk = (el: HTMLElement, cur: number, iv: S.Interval, home: { x: number; y: number; rot: number }, target: Pt, r?: S.Rect): Carry => {
      const { w, h } = size(el, r);
      const sh = $(`.ent-psh[data-for="${el.dataset.carry}"]`);
      sh.style.width = `${w}px`;
      sh.style.height = `${h}px`;
      return { el, cur, iv, w, h, x: home.x, y: home.y, rot: home.rot, sc: 1, z: 0, sh, target: { ...target, rot: 0 }, state: 'idle', gx: 0, gy: 0, gz: 0, from: { x: 0, y: 0, rot: 0, sc: 0, t: 0 } };
    };
    const spw = S.spawner(lay);
    put(spawnEl, 'transform', at(spw.x - S.SPAWNER_W / 2, spw.y - 22, '', Z.palette));
    plusPt = spw.plus;
    const sp2 = S.spawner2(lay);
    put(spawn2El, 'transform', at(sp2.x - S.SPAWNER_W / 2, sp2.y - 22, '', Z.palette));
    plus2Pt = sp2.plus;
    // o mapa das ligações: a caixa e os nós no lugar que o roteiro usa (X passa por eles)
    gp = S.graphPanel(lay);
    graphEl.style.width = `${gp.w}px`;
    graphEl.style.height = `${gp.h}px`;
    put(graphEl, 'transform', at(gp.x, gp.y, '', Z.palette));
    const svg = graphEl.querySelector('svg')!;
    svg.setAttribute('viewBox', `0 0 ${gp.w} ${gp.h}`);
    const lines = Array.from(graphEl.querySelectorAll<SVGLineElement>('.ge'));
    gp.edges.forEach((e, i) => {
      const a = gp!.nodes[e.from]!;
      const b = gp!.nodes[e.to]!;
      const ln = lines[i]!;
      ln.setAttribute('x1', (a.x - gp!.x).toFixed(1));
      ln.setAttribute('y1', (a.y - gp!.y).toFixed(1));
      ln.setAttribute('x2', (b.x - gp!.x).toFixed(1));
      ln.setAttribute('y2', (b.y - gp!.y).toFixed(1));
    });
    gp.nodes.forEach((nd, i) => {
      const el = graphNodes[i]!;
      el.style.left = `${(nd.x - gp!.x).toFixed(1)}px`;
      el.style.top = `${(nd.y - gp!.y).toFixed(1)}px`;
    });
    const brokenEdge = gp.edges.find((e) => e.broken)!;
    const pin = graphEl.querySelector<HTMLElement>('.g-pin')!;
    pin.style.left = `${((gp.nodes[brokenEdge.from]!.x + gp.nodes[brokenEdge.to]!.x) / 2 - gp.x).toFixed(1)}px`;
    pin.style.top = `${((gp.nodes[brokenEdge.from]!.y + gp.nodes[brokenEdge.to]!.y) / 2 - gp.y).toFixed(1)}px`;
    // o DevTools: largura e altura da tela, escondido além da borda direita
    dv = S.devtools(lay);
    devEl.style.width = `${dv.w}px`;
    devEl.style.height = `${dv.h}px`;
    // o caminho que cada peça carregada vai fazer (pontilhado, com os nós), como num programa de animação
    const curve = (a: Pt, b: Pt, bend: number) => {
      const mx = (a.x + b.x) / 2 + bend;
      const my = (a.y + b.y) / 2 - Math.abs(bend) * 0.4;
      return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    };
    mpaths.sub.setAttribute('d', curve(mis.sub, { x: S.cx(lay.subtitle), y: S.cy(lay.subtitle) }, -60));
    mpaths.back.setAttribute('d', curve(mis.back, { x: S.cx(lay.back), y: S.cy(lay.back) }, 150));
    carries = [
      mk(sub, 0, S.T.SUB, mis.sub, { x: S.cx(lay.subtitle), y: S.cy(lay.subtitle) }, lay.subtitle),
      mk(backlink, 3, S.T.BACK, mis.back, { x: S.cx(lay.back), y: S.cy(lay.back) }, lay.back),
    ];
  }

  function stepCarry(c: Carry, t: number, dt: number) {
    const cur = cursors[c.cur]!;
    if (c.state === 'idle' && S.within(c.iv, t)) {
      c.state = 'held';
      c.gx = c.x - cur.tip.x;
      c.gy = c.y - cur.tip.y;
      c.gz = cur.z;
    }
    if (c.state === 'held') {
      // levantada para perto da câmera, a peça sai do plano junto com o cursor (e cresce pela perspectiva)
      c.z = Math.max(0, S.depthPx(cur.z) - S.depthPx(c.gz)) + 10;
      c.sc = S.depthScale(cur.z - c.gz);
      c.x = cur.tip.x + c.gx * c.sc;
      c.y = cur.tip.y + c.gy * c.sc;
      const sway = Math.max(-10, Math.min(10, cur.v.x * 0.006));
      c.rot += (sway - c.rot) * Math.min(1, dt * 5);
      if (t >= c.iv[1]) {
        c.state = 'settle';
        c.from = { x: c.x, y: c.y, rot: c.rot, sc: c.z, t };
      }
    }
    if (c.state === 'settle') {
      const p = S.seg(t, c.from.t, c.from.t + 300, S.ease.back);
      c.x = S.lerp(c.from.x, c.target.x, p);
      c.y = S.lerp(c.from.y, c.target.y, p);
      c.rot = S.lerp(c.from.rot, 0, p);
      c.z = Math.max(0, S.lerp(c.from.sc, 0, Math.min(1, p)));
      if (t >= c.from.t + 300) c.state = 'placed';
    }
    if (c.state === 'placed') {
      c.x = c.target.x;
      c.y = c.target.y;
      c.rot = 0;
      c.z = 0;
    }
    const w = lifted(c.x, c.y, c.z);
    put(c.el, 'transform', at(w.x - c.w / 2, w.y - c.h / 2, ` rotate(${c.rot.toFixed(2)}deg) rotateX(${Math.min(14, c.z * 0.05).toFixed(1)}deg)`, Z.content + c.z));
    flag(c.el, 'is-held', c.state === 'held');
    planeShadow(c.sh, c.x, c.y, c.w, c.h, c.state === 'idle' || c.state === 'placed' ? 0 : c.z);
  }

  /** O ponto preso ao cursor, sem escapar do objeto (o balão pode ter andado desde o roteiro). */
  function grabOffset(p: Pop, tip: Pt) {
    const gx = Math.max(-p.w / 2 + 14, Math.min(p.w / 2 - 14, p.x - tip.x));
    const gy = Math.max(-p.h / 2 + 12, Math.min(p.h / 2 - 12, p.y - tip.y));
    return { gx, gy };
  }

  /** Empurra o balão para fora da caixa, só para os lados permitidos (cada um foge para o seu canto). */
  function pushOut(p: Pop, bx: S.Rect, dt: number, dirs: { l?: true; r?: true; u?: true; d?: true }) {
    if (p.mode !== 'idle') return;
    const l = p.x - p.w / 2;
    const r = p.x + p.w / 2;
    const t = p.y - p.h / 2;
    const b = p.y + p.h / 2;
    if (r <= bx.l || l >= bx.r || b <= bx.t || t >= bx.b) return;
    const penL = dirs.l ? r - bx.l : Infinity;
    const penR = dirs.r ? bx.r - l : Infinity;
    const penU = dirs.u ? b - bx.t : Infinity;
    const penD = dirs.d ? bx.b - t : Infinity;
    const m = Math.min(penL, penR, penU, penD);
    if (!Number.isFinite(m)) return;
    let dx = 0;
    let dy = 0;
    if (m === penL) dx = -penL;
    else if (m === penR) dx = penR;
    else if (m === penU) dy = -penU;
    else dy = penD;
    p.x += dx;
    p.y += dy;
    p.vx = p.vx * 0.5 + (dx / Math.max(dt, 0.008)) * 0.25;
    p.vy = p.vy * 0.5 + (dy / Math.max(dt, 0.008)) * 0.25;
    p.vr = 0;
    p.rot += (0 - p.rot) * 0.5;
    p.vjig += Math.min(1.2, Math.abs(dx) + Math.abs(dy)) * 0.12;
  }

  /** A sombra na parede branca atrás: o mesmo formato da peça (tamanho, cantos e giro), deslocada para baixo
   *  e para a direita, maior e mais suave quanto mais longe da parede a peça está. */
  function wallShadow(el: HTMLElement, x: number, y: number, w: number, h: number, rot: number, height: number, show: boolean, fade = 1) {
    if (!show) {
      put(el, 'opacity', '0');
      return;
    }
    put(el, 'width', `${w.toFixed(1)}px`);
    put(el, 'height', `${h.toFixed(1)}px`);
    const sc = 1 + height / 900;
    put(el, 'transform', at(x - w / 2 + height * 0.22, y - h / 2 + height * 0.32, ` rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`, Z.popShadow));
    put(el, 'opacity', (fade * 0.3 * Math.max(0.3, 1 - height / 1600)).toFixed(3));
  }

  /** A sombra de algo que está zPx acima do plano: cai para baixo e para a direita, maior e mais fraca quanto mais alto. */
  function planeShadow(el: HTMLElement, x: number, y: number, w: number, h: number, zPx: number) {
    if (zPx < 4) {
      put(el, 'opacity', '0');
      return;
    }
    const sc = 1 + zPx / 700;
    put(el, 'transform', at(x - w / 2 + zPx * 0.12, y - h / 2 + zPx * 0.16, ` scale(${sc.toFixed(3)})`, Z.popShadow));
    put(el, 'opacity', (Math.min(1, zPx / 120) * Math.max(0.25, 1 - zPx / 1400) * 0.5).toFixed(3));
  }

  function stepPop(p: Pop, t: number, dt: number) {
    p.ty *= p.mode === 'held' ? 1 : Math.exp(-4 * dt);
    if (p.mode === 'idle') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-7 * dt);
      p.vy *= Math.exp(-7 * dt);
      p.rot += p.vr * dt;
      p.vr *= Math.exp(-5 * dt);
      p.rot = Math.max(-18, Math.min(18, p.rot));
    } else if (p.mode === 'fly') {
      // lançado com o embalo do balanço: segue a curva e cai um pouco (gravidade)
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.vr *= Math.exp(-3 * dt);
      const reach = Math.max(vw, vh) / Math.min(camS, 1) / 2 + Math.max(p.w, p.h);
      if (Math.abs(p.x) > reach || Math.abs(p.y) > reach) p.mode = 'gone';
    }
    const bob = p.mode === 'idle' ? Math.sin(t / 650 + p.phase) * 3 : 0;
    if (p.mode === 'idle') p.z *= Math.exp(-6 * dt);
    flag(p.el, 'is-gone', p.mode === 'gone');
    // a gelatina: uma mola na escala, cutucada quando o balão é agarrado, solto ou empurrado (firme: os
    // cursores mexem nos balões sem eles virarem geleia)
    p.vjig += (-300 * p.jig - 22 * p.vjig) * dt;
    p.jig += p.vjig * dt;
    if (dt > 0) {
      p.svx = p.svx * 0.7 + ((p.x - p.lx) / dt) * 0.3;
      p.svy = p.svy * 0.7 + ((p.y - p.ly) / dt) * 0.3;
    }
    p.lx = p.x;
    p.ly = p.y;
    if (p.mode !== 'gone') {
      const w = lifted(p.x, p.y + bob, p.z);
      // levantado, o balão inclina um pouco em 3D, como uma folha segura pela ponta
      const tiltX = Math.min(18, p.z * 0.04);
      const jg = Math.max(-0.06, Math.min(0.06, p.jig));
      put(
        p.el,
        'transform',
        at(w.x - p.w / 2, w.y - p.h / 2, `${lensOf(p.x, p.y, p.z)}${stretch(p.svx, p.svy, 0.05)} rotate(${p.rot.toFixed(2)}deg) rotateX(${tiltX.toFixed(1)}deg) rotateY(${p.ty.toFixed(1)}deg) scale(${(1 + jg).toFixed(3)}, ${(1 - jg).toFixed(3)})`, Z.pop + p.z)
      );
    }
    wallShadow(p.sh, p.x, p.y + bob, p.w, p.h, p.rot, 34 + p.z, p.mode !== 'gone' && p.el.classList.contains('is-in'));
  }

  // ---------------- os cursores ----------------
  function stepCursors(tr: Record<S.CursorId, S.Track>, t: number, dt: number) {
    // 1) onde o roteiro manda cada um, mais o desvio dos esbarrões (mola) e um balanço quando solto
    const base: Pt[] = [];
    for (const cur of cursors) {
      const track = tr[cur.id];
      const chaos = S.CHAOS.includes(cur.id);
      const p = chaos ? S.teleportSample(track.keys, t) : S.sample(track.keys, t);
      // as chaves da tela (o DevTools preso no canto) viram um ponto do plano com a câmera de agora
      cur.scr = { x: p.x, y: p.y };
      if (track.keys[0]?.screen) {
        const w0 = unproject(p.x, p.y);
        p.x = w0.x;
        p.y = w0.y;
      }
      for (const bt of track.blinks ?? []) {
        if (once(`blink-${cur.id}-${bt}`, t >= bt)) {
          cur.eyesIn.animate([{ scale: '1 1' }, { scale: '1 0.06', offset: 0.45 }, { scale: '1 1' }], { duration: 150, easing: 'ease-in-out' });
          snd('blink', { gain: 0.2, rate: tone(rand, 1.1, 3) });
        }
      }
      cur.on = t >= track.born && t < track.gone;
      cur.thinking = cur.on && track.think.some((iv) => S.within(iv, t));
      cur.z = p.z;
      cur.sc = S.depthScale(p.z);
      cur.pressed = track.press.some((iv) => S.within(iv, t));
      cur.tapping = track.taps.some((tt) => t >= tt && t < tt + 70);
      // nasce num estalo (cresce passando do ponto) e some num estalo
      for (const tt of track.taps) if (once(`tap-${cur.id}-${tt}`, t >= tt)) snd('key', { gain: 0.3, rate: tone(rand, 0.9, 4) });
      if (once(`born-${cur.id}`, cur.on) && !track.enter) {
        snd('pop', { gain: 0.32, rate: step(popN++, chaos ? 0.84 : 1) });
        // nasce pequeno, cresce passando do ponto e abre os olhos (estava "dormindo" dentro do botão)
        cur.svg.animate([{ scale: '0' }, { scale: '1.3', offset: 0.6 }, { scale: '1' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.2,1)' });
        cur.eyesIn.animate([{ scale: '1 0.08' }, { scale: '1 0.08', offset: 0.45 }, { scale: '1 1.15', offset: 0.75 }, { scale: '1 1' }], { duration: 640, easing: 'ease-out' });
        burst({ x: p.x + 20, y: p.y + 20 }, 8, 0.9);
        ripple({ x: p.x + 20, y: p.y + 20 });
      }
      if (once(`gone-${cur.id}`, t >= track.gone - 280)) {
        cur.svg.animate([{ scale: '1' }, { scale: '1.3', offset: 0.35 }, { scale: '0' }], { duration: 280, easing: 'ease-in', fill: 'forwards' });
        snd('hum-2', { gain: 0.07, rate: tone(rand, 1.5, 3) });
      }
      cur.vox += (-90 * cur.ox - 11 * cur.vox) * dt;
      cur.voy += (-90 * cur.oy - 11 * cur.voy) * dt;
      cur.ox += cur.vox * dt;
      cur.oy += cur.voy * dt;
      const loose = cur.pressed ? 0 : cur.thinking ? 0.5 : 1;
      base.push({ x: p.x + Math.sin(t / 420 + cur.phase) * 3.5 * loose, y: p.y + Math.cos(t / 530 + cur.phase * 1.3) * 3 * loose });
    }
    // 2) esbarrões: dois soltos na mesma profundidade não se atravessam
    for (let i = 0; i < cursors.length; i++) {
      for (let j = i + 1; j < cursors.length; j++) {
        const a = cursors[i]!;
        const b = cursors[j]!;
        // só nos encontros combinados, e nunca com quem está trabalhando ou pensando (nada de tremer)
        if (!S.BUMP_WINDOWS.some((iv) => S.within(iv, t))) continue;
        if (!a.on || !b.on || a.pressed || b.pressed || a.thinking || b.thinking || Math.abs(a.z - b.z) > 0.5) continue;
        const ax = base[i]!.x + a.ox + 24 * a.sc;
        const ay = base[i]!.y + a.oy + 24 * a.sc;
        const bx = base[j]!.x + b.ox + 24 * b.sc;
        const by = base[j]!.y + b.oy + 24 * b.sc;
        const dx = bx - ax;
        const dy = by - ay;
        const dist = Math.hypot(dx, dy) || 0.01;
        const reach = 19 * (a.sc + b.sc);
        if (dist >= reach) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const over = reach - dist;
        a.ox -= nx * over * 0.5;
        a.oy -= ny * over * 0.5;
        b.ox += nx * over * 0.5;
        b.oy += ny * over * 0.5;
        a.vox -= nx * over * 28;
        a.voy -= ny * over * 28;
        b.vox += nx * over * 28;
        b.voy += ny * over * 28;
        const key = a.id + b.id;
        if (t - (lastBonk.get(key) ?? -1e9) > 500) {
          lastBonk.set(key, t);
          a.bonkUntil = b.bonkUntil = t + 340;
          // o "hum" dos esbarrões: curto e raro (no máximo um a cada 0,4 s), para não se destacar
          if (t - lastHum > 400) {
            lastHum = t;
            snd(rand() < 0.5 ? 'hum-1' : 'hum-2', { gain: 0.08, rate: tone(rand, 1.4, 4) });
          }
          if (t < S.T.HIGH5 - 500) burst({ x: (ax + bx) / 2, y: (ay + by) / 2 }, 6, 1);
        }
      }
    }
    // 3) desenha
    cursors.forEach((cur, i) => {
      const x = base[i]!.x + cur.ox;
      const y = base[i]!.y + cur.oy;
      // o agente do caos pulou: deixa um rastro vermelho de onde estava até onde apareceu
      if (S.CHAOS.includes(cur.id) && cur.prev && cur.on && Math.hypot(x - cur.prev.x, y - cur.prev.y) > 40) {
        trail(cur.prev, { x, y });
        cur.svg.animate([{ scale: '0.6 1.3', opacity: 0.4 }, { scale: '1', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.2,.9,.2,1.3)' });
      }
      cur.tip = { x, y };
      if (cur.prev && dt > 0) {
        cur.v.x = cur.v.x * 0.7 + ((x - cur.prev.x) / dt) * 0.3;
        cur.v.y = cur.v.y * 0.7 + ((y - cur.prev.y) / dt) * 0.3;
      }
      cur.prev = { x, y };
      flag(cur.el, 'is-on', cur.on);
      const lean = Math.max(-1, Math.min(1, cur.v.x / 1400)) * 14;
      cur.tilt += (lean - cur.tilt) * Math.min(1, dt * 8);
      // fora do plano de verdade: a perspectiva da cena aumenta (perto) ou diminui (fundo) o cursor.
      // O desenho tem 5x o tamanho e entra reduzido (0,2), para continuar nítido quando chega perto.
      const z = cur.z;
      // sempre um pouco acima dos painéis (paleta, DevTools, grafo), que ficam a poucos px do plano
      const zPx = S.depthPx(z) + (cur.pressed ? 9 : 14);
      const w3 = lifted(x, y, zPx);
      put(cur.el, 'transform', at(w3.x, w3.y, `${lensOf(x, y, zPx)} rotate(${cur.tilt.toFixed(2)}deg)${stretch(cur.v.x, cur.v.y, 0.12)} scale(0.16667)`, zPx));
      put(cur.el, 'opacity', Math.max(0.5, z < 0 ? 1 + z * 0.3 : 1).toFixed(3));
      flag(cur.el, 'is-press', cur.pressed || cur.tapping);
      flag(cur.el, 'is-bonk', t < cur.bonkUntil);
      flag(cur.el, 'is-thinking', cur.thinking);
      if (cur.pressed && !cur.pressedBefore && cur.on) ripple(cur.tip);
      cur.pressedBefore = cur.pressed;
      const looks = tr[cur.id].looks;
      const lk = looks ? looks.filter((l) => l.t <= t).pop() : undefined;
      if (lk && looks && t < looks[looks.length - 1]!.t + 450) {
        // olhando em volta como gente: os olhos pulam rápido para um lugar, param, pulam para outro
        cur.eyes.style.transform = `translate(${lk.x.toFixed(2)}px, ${lk.y.toFixed(2)}px)`;
      } else if (cur.thinking) {
        // pensando: os olhos procuram em volta, devagar
        cur.eyes.style.transform = `translate(${(Math.sin(t / 260 + cur.phase) * 4.5).toFixed(2)}px, ${(-2.5 + Math.cos(t / 410) * 1.5).toFixed(2)}px)`;
      } else {
        const sp = Math.hypot(cur.v.x, cur.v.y) || 1;
        const look = Math.min(1, sp / 700) * 5;
        cur.eyes.style.transform = `translate(${((cur.v.x / sp) * look).toFixed(2)}px, ${((cur.v.y / sp) * look).toFixed(2)}px)`;
      }
      // sombra no plano: mais alto o cursor, mais longe, maior e mais fraca
      // a sombra tem o formato do cursor (a silhueta) e cai na parede atrás, mais longe quanto mais alto
      const up = Math.max(0, zPx);
      const shScale = 1 + up / 700;
      put(cur.sh, 'transform', at(x + 4 + up * 0.14, y + 6 + up * 0.2, ` rotate(${cur.tilt.toFixed(2)}deg) scale(${shScale.toFixed(3)})`, Z.curShadow));
      put(cur.sh, 'opacity', (cur.on && z > -0.15 ? 0.34 * Math.max(0.3, 1 - up / 1500) : 0).toFixed(3));
    });
  }

  // ---------------- o quadro ----------------
  let t = 0;
  let lastNow = performance.now();
  let raf = 0;
  let measuredGlyphs = false;
  let glAt = 0;
  let planned = false;
  let ended = false;

  function update(dt: number) {
    const c = S.sampleCam(camKeys, t);
    camS = c.s;
    cam3 = c;
    cosX = Math.cos((c.rx * Math.PI) / 180);
    sinX = Math.sin((c.rx * Math.PI) / 180);
    cosY = Math.cos((c.ry * Math.PI) / 180);
    sinY = Math.sin((c.ry * Math.PI) / 180);
    put(cam, 'transform', `rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg) scale(${c.s.toFixed(4)}) translate3d(${(-c.fx).toFixed(1)}px, ${(-c.fy).toFixed(1)}px, 0)`);

    flag(root, 'is-falling', t >= S.T.FALL_TEXT);
    if (once('s-zoom', t >= S.T.ZOOM[0])) snd('whoosh-in', { gain: 0.6 });
    if (once('s-pop', t >= S.T.POPUP)) snd('pop', { gain: 0.3, rate: 0.75 });
    if (once('s-loaded', t >= S.T.LOADED)) snd('click', { gain: 0.35, rate: 1.25 });
    if (once('s-back', t >= S.T.CAM_BACK[0])) snd('whoosh-out', { gain: 0.42 });
    if (once('s-enter', t >= S.T.A_ENTER[0])) snd('whoosh-in', { gain: 0.3, rate: 1.15, dur: 2.4, offset: 0.6 });
    if (once('s-high5', t >= S.T.HIGH5)) snd('hum-1', { gain: 0.1, rate: 1.5 });
    if (once('s-end', t >= S.T.END)) snd('whoosh-out', { gain: 0.24, rate: 1.2, dur: 2.6 });
    // o 404 em 3D assume cedo (assim que o three.js chegou) para a sombra ter tempo de entrar em fade
    if (!measuredGlyphs && (t >= S.T.NOT_FOUND - 1000 || (glMod && t >= S.T.NOT_FOUND - 2700))) {
      glAt = t;
      setupBodies();
      measuredGlyphs = true;
    }
    if (measuredGlyphs && t < S.T.LETTERS_GONE + 300) stepBodies(t, dt);
    flag(root, 'letters-gone', t >= S.T.LETTERS_GONE);
    if (gl && t >= S.T.LETTERS_GONE + 450) {
      gl.dispose();
      gl = null;
    }


    if (!popsMeasured && t >= S.T.POPUP - 150) measurePops();
    if (popsMeasured) {
      flag(p0.el, 'is-in', t >= S.T.POPUP && t < S.T.COLLAPSE[1]);
      flag(p0.el, 'is-loaded', t >= S.T.LOADED);
      const s1 = S.seg(t, S.T.SPLIT1[0], S.T.SPLIT1[1], S.ease.inOut);
      const s2 = S.seg(t, S.T.SPLIT2[0], S.T.SPLIT2[1], S.ease.inOut);
      // o cartão novo sai de trás do do meio (sempre nítido, sem trocar de lugar) e a ligação líquida
      // entre os dois estica, segura um instante e rompe; os respingos voltam para dentro de cada um
      void s1;
      void s2;
      // o filtro do líquido fica ligado do começo da primeira divisão até os respingos voltarem na segunda;
      // liga e desliga em fade (CSS), sem piscar
      const gooOn = t >= S.T.SPLIT1[0] && t < S.T.SPLIT2[0] + (S.T.SPLIT2[1] - S.T.SPLIT2[0]) * (S.SPLIT_SNAP + 0.16);
      flag(goo, 'is-on', gooOn);
      flag(p1.el, 'is-in', t >= S.T.SPLIT1[0]);
      flag(p2.el, 'is-in', t >= S.T.SPLIT2[0]);
      flag(p0.el, 'is-verifying', t >= S.T.VERIFY_CLICK);
      let neck = '';
      for (const [p, iv, to] of [
        [p1, S.T.SPLIT1, spots.p1],
        [p2, S.T.SPLIT2, spots.p2],
      ] as const) {
        if (!S.within(iv, t)) continue;
        const u = (t - iv[0]) / (iv[1] - iv[0]);
        const f = S.splitPull(u);
        p.x = S.lerp(p0.x, to.x, f);
        p.y = S.lerp(p0.y, to.y, f);
        p.vx = 0;
        p.vy = 0;
        if (once(`snap-${iv[0]}`, u >= S.SPLIT_SNAP)) {
          snd('thud-2', { gain: 0.18, rate: tone(rand, 1.5, 2) });
          p.vjig -= 5;
          p0.vjig += 3;
        }
        p.vjig += (-260 * p.jig - 9 * p.vjig) * dt;
        p.jig += p.vjig * dt;
        const jg = Math.max(-0.2, Math.min(0.2, p.jig));
        const sj = ` scale(${(1 + jg).toFixed(3)}, ${(1 - jg).toFixed(3)})`;
        // bem atrás do cartão do meio (não 0,15 px): planos quase iguais em 3D dão costura e corte
        put(p.el, 'transform', at(p.x - p.w / 2, p.y - p.h / 2, sj, Z.popBehind));
        // rompida a ponte, a bolha de quem saiu encolhe para dentro do próprio cartão (escondida): a mola
        // traz os dois cartões para perto e, com a bolha inteira, o filtro voltaria a grudá-los
        const ins = S.seg(u, S.SPLIT_SNAP, S.SPLIT_SNAP + 0.05, S.ease.out) * 44;
        put(p === p1 ? g1 : g2, 'transform', at(p.x - p.w / 2, p.y - p.h / 2, ` scale(${((1 + jg) * (1 - ins / p.w)).toFixed(3)}, ${((1 - jg) * (1 - ins / p.h)).toFixed(3)})`));
        wallShadow(p.sh, p.x, p.y, p.w, p.h, 0, 34, true);
        neck = S.liquidNeck({ x: p0.x, y: p0.y, w: p0.w, h: p0.h }, { x: p.x, y: p.y, w: p.w, h: p.h }, u);
      }
      if (neckPath.getAttribute('d') !== neck) neckPath.setAttribute('d', neck);
      p0.vjig += (-260 * p0.jig - 9 * p0.vjig) * dt;
      p0.jig += p0.vjig * dt;
      if (gooOn) {
        const j = Math.max(-0.15, Math.min(0.15, p0.jig));
        put(g0, 'transform', at(p0.x - p0.w / 2, p0.y - p0.h / 2, ` scale(${(1 + j).toFixed(3)}, ${(1 - j).toFixed(3)})`));
        // a bolha de quem ainda não saiu fica escondida atrás da do meio
        if (t < S.T.SPLIT2[0]) put(g2, 'transform', at(p0.x - p0.w / 2, p0.y - p0.h / 2, ' scale(0.7)'));
        // depois que a primeira rompeu, a bolha dela volta para trás da do meio (o cartão já anda sozinho)
        if (t >= S.T.SPLIT1[1]) put(g1, 'transform', at(p0.x - p0.w / 2, p0.y - p0.h / 2, ' scale(0.7)'));
      }
      // verificado, o cartão do meio encolhe um pouco e some no lugar (sem virar bola)
      const k0 = S.seg(t, S.T.COLLAPSE[0], S.T.COLLAPSE[1], S.ease.inOut);
      const j0 = Math.max(-0.15, Math.min(0.15, p0.jig));
      put(p0.el, 'transform', at(p0.x - p0.w / 2, p0.y - p0.h / 2, ` scale(${(S.lerp(1, 0.86, k0) * (1 + j0)).toFixed(3)}, ${(S.lerp(1, 0.86, k0) * (1 - j0)).toFixed(3)})`, Z.pop));
      put(p0.el, 'opacity', (1 - k0).toFixed(3));
      // a sombra cresce junto com o cartão (que entra com escala de 0,2 a 1 em 0,5 s): aparecer inteira
      // atrás de um cartão ainda pequeno parecia um corte nele
      const in0 = S.seg(t, S.T.POPUP + 80, S.T.POPUP + 700, S.ease.inOutSine);
      wallShadow(p0.sh, p0.x, p0.y, p0.w * S.lerp(0.5, 1, in0), p0.h * S.lerp(0.5, 1, in0), 0, 34, t >= S.T.POPUP && t < S.T.COLLAPSE[1], in0 * (1 - k0));
    }

    if (!planned && t >= S.T.PLAN) {
      plan();
      planned = true;
    }
    if (L && tracks && pal && meet) rebuild(L, tracks, pal, meet, dt);
    else if (popsMeasured) {
      if (t >= S.T.SPLIT1[1]) stepPop(p1, t, dt);
      if (t >= S.T.SPLIT2[1]) stepPop(p2, t, dt);
    }

    flag(root, 'is-reveal', t >= S.T.END);
  }

  function rebuild(lay: S.Layout, tr: Record<S.CursorId, S.Track>, pl: ReturnType<typeof S.palette>, mt: ReturnType<typeof S.meetingPoints>, dt: number) {
    const card = lay.card;
    const fp = S.fontPicker(lay);

    // os ganchos do cursor B: no instante do agarrão, o balão pode ter sido empurrado
    for (const key of tr.b.keys) {
      if (key.tag === 'p1' && once('patch-p1', t >= S.T.GRAB_P1[0] - 380)) {
        key.x = p1.x - p1.w * 0.2;
        key.y = p1.y;
      }
      if (key.tag === 'p2' && once('patch-p2', t >= S.T.GRAB_P2[0] - 300)) {
        key.x = p2.x + p2.w * 0.15;
        key.y = p2.y - p2.h * 0.1;
      }
    }

    stepCursors(tr, t, dt);
    for (const cur of cursors) {
      for (const ct of tr[cur.id].clicks) if (once(`click-${cur.id}-${ct}`, t >= ct)) ripple(cur.tip);
    }

    {
      const speed = (c: Cursor) => Math.hypot(c.v.x, c.v.y);
      let drag = 0;
      if (S.within(S.T.BOX, t)) drag = speed(A);
      else if (S.within([S.T.LOGO[0] + 350, S.T.LOGO[1]], t)) drag = speed(D) * 0.7;
      else if (carries.some((c) => c.state === 'held')) drag = Math.max(...carries.filter((c) => c.state === 'held').map((c) => speed(cursors[c.cur]!))) * 0.8;
      else if (cpfState.mode === 'held') drag = speed(C) * 0.8;
      wood.set(quiet || document.hidden ? 0 : drag > 0 ? Math.min(0.55, 0.14 + drag / 2200) : 0);
    }

    // o "+" que A abre: cada clique dele cria um cursor, que sai de trás do botão
    // o ponto verde carrega (pulsa) e, num estalo, vira o primeiro cursor

    // o contador "cursores 01 +": cada clique de A no "+" sobe o número e um cursor sai do botão
    flag(spawnEl, 'is-on', S.within(S.T.SPAWNER, t));
    const spawns = [S.T.SPAWN_B, S.T.SPAWN_C, S.T.SPAWN_D];
    const count = `0${1 + spawns.filter((st) => t >= st).length}`;
    if (spawnN.textContent !== count) {
      spawnN.textContent = count;
      spawnN.animate([{ translate: '0 8px', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1.3)' });
    }
    for (const st of spawns) {
      if (once(`spawn-${st}`, t >= st)) {
        spawnPlus.animate([{ scale: '1' }, { scale: '0.72', offset: 0.3 }, { scale: '1.18', offset: 0.7 }, { scale: '1' }], { duration: 340, easing: 'ease-out' });
        spawnEl.animate([{ scale: '1' }, { scale: '1.04 0.94', offset: 0.35 }, { scale: '1' }], { duration: 300, easing: 'ease-out' });
      }
    }
    // o segundo botão, embaixo: "agentes do caos 00 +" (eles acham os problemas; os outros consertam)
    flag(spawn2El, 'is-on', S.within(S.T.SPAWNER2, t));
    const chaosSpawns = [S.T.SPAWN_X, S.T.SPAWN_Y];
    const count2 = `0${chaosSpawns.filter((st) => t >= st).length}`;
    if (spawn2N.textContent !== count2) {
      spawn2N.textContent = count2;
      spawn2N.animate([{ translate: '0 8px', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1.3)' });
    }
    for (const st of chaosSpawns) {
      if (once(`spawn2-${st}`, t >= st)) {
        spawn2Plus.animate([{ scale: '1' }, { scale: '0.72', offset: 0.3 }, { scale: '1.18', offset: 0.7 }, { scale: '1' }], { duration: 340, easing: 'ease-out' });
        spawn2El.animate([{ scale: '1' }, { scale: '1.04 0.94', offset: 0.35 }, { scale: '1' }], { duration: 300, easing: 'ease-out' });
      }
    }

    // X: o mapa das ligações; os nós acendem quando ele passa; a ligação quebrada vira achado e depois fica verde
    if (gp) {
      flag(graphEl, 'is-on', t >= S.T.GRAPH_OPEN && t < S.T.GRAPH_CLOSE + 250);
      gp.nodes.forEach((nd, i) => {
        const el = graphNodes[i]!;
        if (!el.classList.contains('is-seen') && t >= S.T.GRAPH_TRACE[0] - 50 && Math.hypot(X.tip.x - nd.x, X.tip.y - nd.y) < 20) el.classList.add('is-seen');
      });
      flag(graphBroken, 'is-found', t >= S.T.GRAPH_FOUND);
      flag(graphEl, 'is-found', t >= S.T.GRAPH_FOUND && t < S.T.GRAPH_FIXED);
      flag(graphEl, 'is-fixed', t >= S.T.GRAPH_FIXED);
      if (once('graph-fixed', t >= S.T.GRAPH_FIXED)) {
        graphEl.animate([{ scale: '1' }, { scale: '1.05', offset: 0.35 }, { scale: '1' }], { duration: 420, easing: 'ease-out' });
        const e = gp.edges.find((ed) => ed.broken)!;
        burst({ x: (gp.nodes[e.from]!.x + gp.nodes[e.to]!.x) / 2, y: (gp.nodes[e.from]!.y + gp.nodes[e.to]!.y) / 2 }, 10, 1);
      }
      wallShadow(graphShadow, gp.x + gp.w / 2, gp.y + gp.h / 2, gp.w, gp.h, 0, 30, graphEl.classList.contains('is-on'));
    }

    // Y: o DevTools sai da borda direita na mão dele (a borda acompanha o cursor), na aba Console
    if (dv) {
      const follow = () => Math.max(0, Math.min(1, (dv!.closed - Y.scr.x) / dv!.w));
      let o = 0;
      const F = S.T.DEV_FINAL;
      if (S.within(S.T.DEV_PULL, t) || S.within(S.T.DEV_CLOSE, t)) o = follow();
      else if (t >= S.T.DEV_PULL[1] && t < S.T.DEV_CLOSE[0]) o = 1;
      else if (t >= F[0] && t < F[0] + 400) o = follow();
      else if (t >= F[0] + 400 && t < F[1] - 400) o = 1;
      else if (t >= F[1] - 400 && t < F[1]) o = follow();
      flag(devEl, 'is-on', t >= S.T.SPAWN_Y && t < F[1] + 300);
      // preso no canto da tela: o contrário da câmera e depois a posição na tela
      put(devEl, 'transform', `${uncam()} ${at(dv.closed - 7 - dv.w * o, dv.top, '', Z.palette + 1)}`);
      flag(devEl, 'is-console', t >= S.T.DEV_TAB);
      devLines.forEach((el, i) => {
        const ok = el.classList.contains('ok');
        flag(el, 'is-on', ok ? t >= S.T.DEV_OK + (i - 4) * 120 : t >= S.T.DEV_TAB + 120 + i * 140);
      });
      flag(devLines[0]!, 'is-found', t >= S.T.DEV_FOUND && t < S.T.DEV_OK);
      flag(devEl, 'is-ok', t >= S.T.DEV_OK);
      const errs = t >= S.T.DEV_OK ? '0' : t >= S.T.DEV_TAB ? '3' : '';
      if (devCount.textContent !== errs) devCount.textContent = errs;
    }

    // o fio pontilhado do "+" até o cursor que acabou de nascer (até ele chegar ao seu lugar no leque)
    const births = [...spawns, ...chaosSpawns];
    const bi = ([B, C, D, X, Y] as const).findIndex((_, i) => t >= births[i]! && t < births[i]! + 520);
    const newborn = bi >= 0 ? [B, C, D, X, Y][bi] : undefined;
    flag(tetherSvg, 'is-on', !!newborn);
    flag(tetherSvg, 'is-chaos', bi >= 3);
    if (newborn) {
      const from = bi >= 3 ? plus2Pt : plusPt;
      tether.setAttribute('x1', from.x.toFixed(1));
      tether.setAttribute('y1', from.y.toFixed(1));
      tether.setAttribute('x2', (newborn.tip.x + 14).toFixed(1));
      tether.setAttribute('y2', (newborn.tip.y + 14).toFixed(1));
    }

    // a caixa: C segura o canto de cima à direita, A puxa o de baixo à esquerda
    let bx: S.Rect = card;
    if (t < S.T.BOX[1]) {
      const corner = t >= S.T.BOX[0] ? A.tip : { x: card.r, y: card.t };
      bx = { l: Math.min(card.r, corner.x), t: Math.min(card.t, corner.y), r: Math.max(card.r, corner.x), b: Math.max(card.t, corner.y) };
    }
    flag(box, 'is-on', t >= S.T.BOX[0]);
    if (t >= S.T.BOX[0]) {
      put(box, 'transform', at(bx.l, bx.t, '', Z.box));
      put(box, 'width', `${Math.max(2, bx.r - bx.l).toFixed(1)}px`);
      put(box, 'height', `${Math.max(2, bx.b - bx.t).toFixed(1)}px`);
    }
    flag(box, 'is-filled', t >= S.T.PALETTE_CLICK);
    wallShadow(boxShadow, (bx.l + bx.r) / 2, (bx.t + bx.b) / 2, bx.r - bx.l, bx.b - bx.t, 0, 22, t >= S.T.PALETTE_CLICK, S.seg(t, S.T.PALETTE_CLICK, S.T.PALETTE_CLICK + 500));
    {
      const spw = S.spawner(lay);
      const sp2w = S.spawner2(lay);
      wallShadow(spnShadow, spw.x, spw.y, S.SPAWNER_W, 44, 0, 24, S.within(S.T.SPAWNER, t));
      wallShadow(spcShadow, sp2w.x, sp2w.y, S.SPAWNER_W, 44, 0, 24, S.within(S.T.SPAWNER2, t));
      wallShadow(palShadow, pl.x + S.PALETTE_W / 2, pl.y + 24, S.PALETTE_W, 48, 0, 30, t >= S.T.PALETTE_OPEN && t < S.T.PALETTE_CLOSE);
      const fpw = S.fontPicker(lay);
      wallShadow(fontShadow, fpw.x + S.FONT_W / 2, fpw.y + 28, S.FONT_W, 56, 0, 30, t >= S.T.FONT_OPEN && t < S.T.FONT_CLOSE);
    }
    flag(seed, 'is-on', false);
    const sp = t >= S.T.BOX[0] && t < S.T.BOX[1] ? A.tip : t >= S.T.BOX[1] ? { x: card.l, y: card.b } : { x: card.r, y: card.t };
    put(seed, 'transform', at(sp.x - 9, sp.y - 9, '', Z.seed));
    const inBox = (x: number, y: number) => t >= S.T.BOX[0] && x >= bx.l && x <= bx.r && y >= bx.t && y <= bx.b;

    // as partes pontilhadas aparecem uma a uma e somem quando a peça chega
    slots.forEach((el, i) => {
      const k = el.dataset.k!;
      flag(el, 'is-on', t >= S.T.SLOTS[0] + i * 90 && t < (slotDone[k] ?? 0));
    });

    // os balões: abrem espaço, são empurrados pela caixa e puxados para fora pelo cursor B
    if (t < S.T.BOX[0]) {
      const k = Math.min(1, dt * 2.5);
      const r1 = { x: Math.min(card.r - p1.w * 0.2, vw / 2 - p1.w / 2 - 12), y: card.t - p1.h / 2 - 16 };
      const r2 = { x: Math.max(card.l + p2.w * 0.1, -vw / 2 + p2.w / 2 + 12), y: card.b - p2.h * 0.25 };
      p1.x += (r1.x - p1.x) * k;
      p1.y += (r1.y - p1.y) * k;
      p2.x += (r2.x - p2.x) * k;
      p2.y += (r2.y - p2.y) * k;
    }
    if (t >= S.T.BOX[0] && t < S.T.BOX[1] + 150) {
      pushOut(p1, bx, dt, { r: true, u: true });
      pushOut(p2, bx, dt, { l: true, d: true });
    }
    for (const [p, iv] of [
      [p1, S.T.GRAB_P1],
      [p2, S.T.GRAB_P2],
    ] as const) {
      if (p.mode === 'idle' && S.within(iv, t)) {
        // pega pelo canto de cima do lado para onde vai levar (p1 para a direita, p2 para a esquerda): o
        // resto do balão cai, pendurado pela pega, e vem arrastado atrás da mão
        p.mode = 'held';
        p.vjig += 1;
        const side = p === p1 ? 1 : -1;
        const cxp = p.x + side * (p.w / 2 - 14);
        const cyp = p.y - p.h / 2 + 12;
        const rx = p.x - cxp;
        const ry = p.y - cyp;
        p.len = Math.hypot(rx, ry) || 1;
        p.al = Math.atan2(rx, ry);
        p.al0 = p.al;
        p.val = 0;
        p.rot0 = p.rot;
        p.pvx = B.v.x;
        p.pvy = B.v.y;
        p.gx = cxp - B.tip.x;
        p.gy = cyp - B.tip.y;
      }
      if (p.mode === 'held') {
        // o pêndulo pesado: a gravidade derruba o centro para baixo da pega, o atrito segura o balanço e a
        // mão (que anda devagar) só o arrasta, como uma placa pesada segura pela ponta
        const px = B.tip.x + p.gx;
        const py = B.tip.y + p.gy;
        const dtc = Math.max(dt, 1e-3);
        const ax = Math.max(-9000, Math.min(9000, (B.v.x - p.pvx) / dtc));
        const ay = Math.max(-9000, Math.min(9000, (B.v.y - p.pvy) / dtc));
        p.pvx = B.v.x;
        p.pvy = B.v.y;
        const n = Math.max(1, Math.ceil(dt / 0.008));
        for (let i = 0; i < n; i++) {
          const h = dt / n;
          const acc = -(1700 / p.len) * Math.sin(p.al) - 3.2 * p.val - (0.45 * (ax * Math.cos(p.al) - ay * Math.sin(p.al))) / p.len;
          p.val += acc * h;
          p.al += p.val * h;
        }
        p.x = px + p.len * Math.sin(p.al);
        p.y = py + p.len * Math.cos(p.al);
        p.rot = p.rot0 + ((p.al0 - p.al) * 180) / Math.PI;
        p.ty = Math.max(-12, Math.min(12, p.val * 4));
        p.z += (S.depthPx(B.z) * 0.85 - p.z) * Math.min(1, dt * 7);
        if (t >= iv[1]) {
          // já fora da tela, solto: segue devagar com o embalo da mão e cai (pesado), sem girar
          p.mode = 'fly';
          p.vjig -= 1;
          p.vx = B.v.x * 0.9;
          p.vy = B.v.y * 0.9;
          p.vr = (-p.val * 0.25 * 180) / Math.PI;
        }
      }
      stepPop(p, t, dt);
    }

    // paleta: C a abre, passa pelas cores e escolhe a do fundo
    flag(palEl, 'is-on', t >= S.T.PALETTE_OPEN && t < S.T.PALETTE_CLOSE);
    swatches.forEach((sw, i) => {
      const s = pl.swatches[i]!;
      flag(sw, 'is-hover', t < S.T.PALETTE_CLOSE && Math.hypot(C.tip.x - s.x, C.tip.y - s.y) < 15);
      flag(sw, 'is-picked', i === 4 && t >= S.T.PALETTE_CLICK);
    });
    flag(root, 'is-colored', t >= S.T.PALETTE_CLICK);

    // as peças levadas para o lugar: o logo (D), o subtítulo e o link de volta (A)
    const [sub, backlink] = carries as [Carry, Carry];
    for (const c of carries) stepCarry(c, t, dt);
    // o logo: D clica e ele nasce grande; D puxa a alça do canto para dentro e ele encolhe até o tamanho certo
    const lg = lay.logo;
    const lgW = (lg.r - lg.l) / 2;
    let ls = 1;
    if (t < S.T.LOGO[0] + 350) ls = S.LOGO_BIG;
    else if (t < S.T.LOGO[1]) ls = Math.max(1, Math.min(S.LOGO_BIG, (D.tip.x - S.cx(lg)) / lgW));
    else ls = S.lerp(1.06, 1, S.seg(t, S.T.LOGO[1], S.T.LOGO[1] + 320, S.ease.out));
    logoScale = ls;
    flag(logo, 'is-on', t >= S.T.LOGO[0]);
    put(logo, 'transform', at(lg.l, lg.t, ` scale(${ls.toFixed(3)})`, Z.content + (ls > 1.01 ? 2 : 0)));
    flag(sub.el, 'is-on', inBox(S.misplaced(lay).sub.x, S.misplaced(lay).sub.y) || t >= S.T.BOX[1]);
    flag(sub.el, 'is-placed', sub.state === 'placed');
    flag(backlink.el, 'is-on', t >= S.T.SLOTS[0]);
    flag(backlink.el, 'is-placed', backlink.state === 'placed');

    // título: o errado aparece com a caixa, A o apaga e B digita o certo logo atrás
    flag(wtitle, 'is-on', inBox(S.cx(lay.title), S.cy(lay.title)) || (t >= S.T.BOX[1] && t < S.T.ERASE[1] + 300));
    const erased = S.seg(t, S.T.ERASE[0], S.T.ERASE[1], S.ease.linear);
    wLetters.forEach((el, i) => flag(el, 'is-erased', (i + 0.5) / wLetters.length < erased));
    syncTitle(S.titleText(t));
    flag(title, 'is-typing', t >= S.T.TYPE1[0] && t < S.T.TYPE2[1] + 300);

    // a fonte: A abre o seletor, pensa entre as três e escolhe a da marca; o título vira em 3D
    flag(fontsEl, 'is-on', t >= S.T.FONT_OPEN && t < S.T.FONT_CLOSE);
    fontOpts.forEach((el, i) => {
      const o = fp.opts[i]!;
      flag(el, 'is-hover', t < S.T.FONT_CLOSE && Math.abs(A.tip.x - o.x) < S.FONT_OPT_W / 2 && Math.abs(A.tip.y - o.y) < S.FONT_OPT_H / 2);
      flag(el, 'is-picked', i === 2 && t >= S.T.FONT_PICK);
    });
    if (once('font-flip', t >= S.T.FONT_PICK)) {
      titleIn.animate(
        [
          { transform: 'rotateX(0deg)' },
          { transform: 'rotateX(88deg)', offset: 0.45 },
          { transform: 'rotateX(-88deg)', offset: 0.46 },
          { transform: 'rotateX(0deg)' },
        ],
        { duration: 460, easing: 'ease-in-out' }
      );
    }
    flag(title, 'is-final-font', t >= S.T.FONT_PICK + 200);

    // campos e botão: desenhados arrastando do canto de cima à esquerda (D o e-mail, C a senha, D o botão)
    const draw = (el: HTMLElement, iv: S.Interval, r: S.Rect, tip: Pt) => {
      const on = S.within(iv, t);
      flag(el, 'is-on', on);
      if (on) {
        put(el, 'transform', at(r.l, r.t, '', Z.content + 0.5));
        put(el, 'width', `${Math.max(4, tip.x - r.l).toFixed(1)}px`);
        put(el, 'height', `${Math.max(4, tip.y - r.t).toFixed(1)}px`);
      }
    };
    draw(drawE, S.T.EMAIL, lay.email, D.tip);
    draw(drawP, S.T.PASS, lay.pass, C.tip);
    draw(drawB, S.T.BUTTON, lay.button, D.tip);
    flag(fieldE, 'is-on', t >= S.T.EMAIL[1]);
    flag(labelE, 'is-on', t >= S.T.EMAIL[1] + 80);
    flag(fieldP, 'is-on', t >= S.T.PASS[1]);
    flag(labelP, 'is-on', t >= S.T.PASS[1] + 80);
    flag(fieldE, 'is-focus', t >= S.T.FOCUS_EMAIL && t < S.T.FOCUS_EMAIL + 700);
    flag(fieldP, 'is-focus', t >= S.T.FOCUS_PASS && t < S.T.FOCUS_PASS + 700);

    // o campo que não devia existir: C o arrasta para fora
    if (cpfState.mode === 'idle' && S.within(S.T.CPF, t)) {
      cpfState.mode = 'held';
      cpfState.gx = cpfState.x - C.tip.x;
      cpfState.gy = cpfState.y - C.tip.y;
    }
    if (cpfState.mode === 'held') {
      cpfState.x = C.tip.x + cpfState.gx;
      cpfState.y = C.tip.y + cpfState.gy;
      cpfState.rot += (12 - cpfState.rot) * Math.min(1, dt * 5);
      if (t >= S.T.CPF[1]) {
        cpfState.mode = 'fly';
        cpfState.vy = Math.max(600, C.v.y);
      }
    } else if (cpfState.mode === 'fly') {
      cpfState.vy += 2400 * dt;
      cpfState.y += cpfState.vy * dt;
      cpfState.rot += 200 * dt;
      if (cpfState.y > vh / camS) cpfState.mode = 'gone';
    }
    flag(cpf, 'is-on', cpfState.mode !== 'gone' && (inBox(S.cx(lay.button), S.cy(lay.button)) || t >= S.T.BOX[1]));
    const cpfZ = cpfState.mode === 'held' || cpfState.mode === 'fly' ? Math.max(0, S.depthPx(C.z)) + 10 : 0;
    const cw = lifted(cpfState.x, cpfState.y, cpfZ);
    put(cpf, 'transform', at(cw.x, cw.y, ` translate(-50%, -50%) rotate(${cpfState.rot.toFixed(2)}deg)`, Z.content + cpfZ));

    flag(btn, 'is-on', t >= S.T.BUTTON[1]);
    flag(btn, 'is-painted', t >= S.T.PAINT);

    // os quatro se encontram em cima do cartão (sem partículas: só o aperto dos olhos)
    if (once('high5', t >= S.T.HIGH5)) {
      for (const cur of cursors) cur.bonkUntil = t + 420;
    }

    // o blueprint: enquanto uma peça é criada ou movida, ela mostra a caixa com alças, a âncora com os
    // eixos e o arco de rotação (como num programa de motion graphics); some quando a peça fica pronta
    const giz: { r: S.Rect; rot: number; tag: string }[] = [];
    if (S.within(S.T.BOX, t)) giz.push({ r: bx, rot: 0, tag: 'cartão' });
    if (t >= S.T.LOGO[0] && t < S.T.LOGO[1] + 250) {
      const hw = lgW * logoScale;
      const hh = ((lg.b - lg.t) / 2) * logoScale;
      giz.push({ r: { l: S.cx(lg) - hw, t: S.cy(lg) - hh, r: S.cx(lg) + hw, b: S.cy(lg) + hh }, rot: 0, tag: `logo · ${Math.round(logoScale * 100)}%` });
    }
    for (const [c, tag] of [
      [sub, 'subtítulo'],
      [backlink, 'link'],
    ] as const) {
      if (c.state === 'held' || c.state === 'settle') giz.push({ r: { l: c.x - c.w / 2, t: c.y - c.h / 2, r: c.x + c.w / 2, b: c.y + c.h / 2 }, rot: c.rot, tag });
    }
    const drawRect = (iv: S.Interval, r: S.Rect, tip: Pt, tag: string) => {
      if (S.within(iv, t)) giz.push({ r: { l: r.l, t: r.t, r: Math.max(r.l + 4, tip.x), b: Math.max(r.t + 4, tip.y) }, rot: 0, tag });
    };
    drawRect(S.T.EMAIL, lay.email, D.tip, 'campo · e-mail');
    drawRect(S.T.PASS, lay.pass, C.tip, 'campo · senha');
    drawRect(S.T.BUTTON, lay.button, D.tip, 'botão');
    if (t >= S.T.FONT_OPEN && t < S.T.FONT_PICK + 300) giz.push({ r: lay.title, rot: 0, tag: 'texto · fonte' });
    gizmos.forEach((el, i) => {
      const g = giz[i];
      flag(el, 'is-on', !!g);
      if (!g) return;
      const w = g.r.r - g.r.l;
      const h = g.r.b - g.r.t;
      put(el, 'width', `${w.toFixed(1)}px`);
      put(el, 'height', `${h.toFixed(1)}px`);
      put(el, 'transform', at(g.r.l, g.r.t, ` rotate(${g.rot.toFixed(2)}deg)`, Z.palette + 0.5));
      const tagEl = el.firstElementChild as HTMLElement;
      if (tagEl.textContent !== g.tag) tagEl.textContent = g.tag;
    });
    flag(mpathSvg, 'is-on', sub.state === 'held' || backlink.state === 'held');
    flag(mpaths.sub, 'is-on', sub.state === 'held' || sub.state === 'settle');
    flag(mpaths.back, 'is-on', backlink.state === 'held' || backlink.state === 'settle');

  }

  let paused = false; // só o gancho de desenvolvimento pausa
  const frame = (now: number) => {
    const dt = paused ? 0 : Math.min(50, now - lastNow);
    lastNow = now;
    t += dt;
    if (!paused) update(dt / 1000);
    if (t >= S.T.END + S.T.REVEAL) {
      if (!ended) {
        ended = true;
        done();
      }
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  if (!capture)
    raf = requestAnimationFrame((now) => {
      lastNow = now;
      raf = requestAnimationFrame(frame);
    });

  // mudou o tamanho da tela no meio: os trajetos foram medidos para outra tela, então vai para o fim
  // (só largura ou uma mudança grande de altura: a barra do navegador no celular não conta)
  const onResize = () => {
    if (Math.abs(window.innerWidth - vw) < 3 && Math.abs(window.innerHeight - vh) < 150) return;
    if (!ended) {
      ended = true;
      done();
    }
  };
  window.addEventListener('resize', onResize);
  const w = window as unknown as {
    __entrarSeek?: (ms: number) => number;
    __entrarCapture?: { ready: Promise<unknown>; step(ms: number): { t: number; ended: boolean }; cues(): unknown };
  };
  if (capture) {
    // o relógio de tudo: a cena (update), as animações de CSS, as transições e as do .animate() andam
    // juntas, exatamente `ms` por quadro (as do navegador ficam pausadas e são avançadas à mão)
    const owned = new WeakSet<Animation>();
    const tickAnims = (ms: number) => {
      for (const a of document.getAnimations()) {
        if (!owned.has(a)) {
          owned.add(a);
          a.pause();
          continue; // nasceu neste quadro: começa do zero, como no navegador
        }
        const ct = Number(a.currentTime) || 0;
        a.currentTime = ct + ms;
      }
    };
    w.__entrarCapture = {
      ready: Promise.all([glReady, document.fonts.ready]),
      step(ms: number) {
        if (!ended) {
          t += ms;
          update(ms / 1000);
          if (t >= S.T.END + S.T.REVEAL) {
            ended = true;
            done();
          }
        }
        tickAnims(ms);
        return { t, ended };
      },
      cues: () => ({ fps: 60, end: S.T.END, reveal: S.T.REVEAL, cues, wood: woodCues }),
    };
  }
  if (dev) {
    dbg.__entrarProject = (x: number, y: number, z: number) => project(x, y, z);
    w.__entrarSeek = (ms: number) => {
      paused = true;
      quiet = true;
      while (t < ms && !ended) {
        const d = Math.min(16, ms - t);
        t += d;
        update(d / 1000);
        if (t >= S.T.END + S.T.REVEAL) {
          ended = true;
          done();
        }
      }
      return t;
    };
  }
  return () => {
    GESTURES.forEach((g) => window.removeEventListener(g, onGesture, true));
    wood.stop();
    sfx.close();
    gl?.dispose();
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    if (dev) delete w.__entrarSeek;
  };
}
