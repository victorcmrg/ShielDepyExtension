// O motor da encenação do "Entrar" (decisão 0039): um requestAnimationFrame que, a cada quadro,
// pergunta ao roteiro (script.ts) e à física (physics.ts) onde está cada coisa e escreve só
// transform, opacity e classes. Nada de React por quadro: a página monta a cena uma vez e este
// arquivo a anima. O relógio anda no máximo 50 ms por quadro: com a aba escondida, a cena pausa em
// vez de pular.
import { kickAround, makeBody, rng, stepBody, type Body } from './physics';
import * as S from './script';

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
}

/** No `npm run web:dev`, expõe `window.__entrarSeek(ms)`, que pausa o relógio da cena e o avança até ms
 *  (para conferir quadros sem esperar, mesmo com a aba escondida). No build, o Vite troca DEV por false e
 *  o código sai. */
export function runEntrar(root: HTMLElement, done: () => void): () => void {
  const dev = import.meta.env.DEV;
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const $$ = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rand = rng(404);

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
  const at = (x: number, y: number, extra = '') => `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${extra}`;
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
  let origin: Pt[] = [];
  const digitPlan = [
    { start: S.T.FALL_4A, tip: -80, yaw: 22, kick: -90 },
    { start: S.T.FALL_0, tip: 84, yaw: -8, kick: 40 },
    { start: S.T.FALL_4B, tip: 78, yaw: -30, kick: 120 },
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
        tipTarget: side * (68 + rand() * 20),
        yawTarget: (rand() - 0.5) * 70,
        vspin: (rand() - 0.5) * 300,
      });
    });
  }
  function stepBodies(t: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      for (const b of bodies) {
        if (stepBody(b, h, t, floor, -vw / 2 + 8, vw / 2 - 8) === 'impact' && b.w > 60) kickAround(b, bodies, rand);
      }
    }
    bodies.forEach((b, i) => {
      const o = origin[i]!;
      const g = glyphs[i]!;
      put(g, 'transform', at(b.x - o.x, b.y - o.y, ` rotateY(${b.yaw.toFixed(1)}deg) rotateX(${b.tip.toFixed(1)}deg) rotateZ(${b.spin.toFixed(1)}deg)`));
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
  const mkPop = (sel: string, p: Pt): Pop => ({ el: $(sel), w: 0, h: 0, x: p.x, y: p.y, rot: 0, vx: 0, vy: 0, vr: 0, mode: 'idle', gx: 0, gy: 0, phase: rand() * 6 });
  const p0 = mkPop('.ent-pop.p0', spots.p0);
  const p1 = mkPop('.ent-pop.p1', spots.p1);
  const p2 = mkPop('.ent-pop.p2', spots.p2);
  p2.rot = -4;
  const goo = $('.ent-goo');
  const g0 = $('.goo.g0');
  const g1 = $('.goo.g1');
  const g2 = $('.goo.g2');
  let popsMeasured = false;
  function measurePops() {
    for (const p of [p0, p1, p2]) {
      p.w = p.el.offsetWidth;
      p.h = p.el.offsetHeight;
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
  const placePop = (p: Pop, extra = '') => put(p.el, 'transform', at(p.x - p.w / 2, p.y - p.h / 2, ` rotate(${p.rot.toFixed(2)}deg)${extra}`));

  // ---------------- a reconstrução (montada quando a tela final já pode ser medida) ----------------
  let L: S.Layout | null = null;
  let tracks: Record<S.CursorId, S.Track> | null = null;
  let pal: ReturnType<typeof S.palette> | null = null;
  let ph: Pt = { x: 0, y: 0 };
  const cursors = (['a', 'b', 'c', 'd'] as const).map((id) => ({
    id,
    el: $(`.ent-cur[data-id="${id}"]`),
    sh: $(`.ent-cur-sh[data-id="${id}"]`),
    eyes: root.querySelector<SVGGElement>(`.ent-cur[data-id="${id}"] .eyes`)!,
    prev: null as Pt | null,
    v: { x: 0, y: 0 },
    tip: { x: 0, y: 0 },
    z: -1,
    pressedBefore: false,
  }));
  const ripples = $$('.ent-rip');
  let rippleNext = 0;
  const fired = new Set<string>();
  function ripple(p: Pt) {
    const r = ripples[rippleNext++ % ripples.length]!;
    r.animate(
      [
        { transform: at(p.x - 20, p.y - 20, ' scale(0.3)'), opacity: 0.9 },
        { transform: at(p.x - 20, p.y - 20, ' scale(1.7)'), opacity: 0 },
      ],
      { duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
  }

  const box = $('.ent-box');
  const seed = $('.ent-seed');
  const wtitle = $('.ent-wtitle');
  const wLetters = $$('.ent-wtitle .wl');
  const title = $('.ent-title');
  const tLetters = $$('.ent-title .tl');
  const sub = $('.ent-sub');
  const phEl = $('.ent-ph');
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
  const backlink = $('.ent-backlink');
  const palEl = $('.ent-palette');
  const swatches = $$('.ent-palette .sw');
  const prog = $('.ent-prog');
  const progN = $('.ent-prog-n');
  const cpfState = { x: 0, y: 0, rot: 0, vy: 0, mode: 'idle' as 'idle' | 'held' | 'fly' | 'gone', gx: 0, gy: 0 };
  const phState = { gx: 0, gy: 0, held: false };

  const placeRect = (el: HTMLElement, r: S.Rect) => {
    el.style.width = `${(r.r - r.l).toFixed(1)}px`;
    el.style.height = `${(r.b - r.t).toFixed(1)}px`;
    put(el, 'transform', at(r.l, r.t));
  };

  function plan() {
    const m = (k: string) => rel(root.querySelector(`.ent-final [data-m="${k}"]`)!);
    L = {
      vw,
      vh,
      card: m('card'),
      logo: m('logo'),
      title: m('title'),
      subtitle: m('subtitle'),
      emailLabel: m('emailLabel'),
      email: m('email'),
      passLabel: m('passLabel'),
      pass: m('pass'),
      button: m('button'),
      back: m('back'),
    };
    tracks = S.cursorTracks(L);
    camKeys = [...S.introCamera(vw, vh), ...S.rebuildCamera(L)];
    pal = S.palette(L);
    ph = S.logoPlaceholder(L);
    put(palEl, 'transform', at(pal.x, pal.y));
    placeRect(wtitle, L.title);
    placeRect(title, L.title);
    placeRect(sub, L.subtitle);
    placeRect(logo, L.logo);
    placeRect(fieldE, L.email);
    placeRect(fieldP, L.pass);
    placeRect(labelE, L.emailLabel);
    placeRect(labelP, L.passLabel);
    placeRect(btn, L.button);
    placeRect(backlink, L.back);
    const bw = L.button.r - L.button.l;
    const bh = L.button.b - L.button.t;
    cpf.style.width = `${bw}px`;
    cpf.style.height = `${bh}px`;
    cpfState.x = S.cx(L.button);
    cpfState.y = S.cy(L.button);
    cpfState.rot = 2;
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
    const penL = dirs.l ? r - bx.l : Infinity; // empurrar para a esquerda
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
    p.vr += (dx - dy) * 0.6;
  }

  function stepPop(p: Pop, t: number, dt: number) {
    if (p.mode === 'idle') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-7 * dt);
      p.vy *= Math.exp(-7 * dt);
      p.rot += p.vr * dt;
      p.vr *= Math.exp(-5 * dt);
      p.rot = Math.max(-18, Math.min(18, p.rot));
    } else if (p.mode === 'fly') {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const reach = Math.max(vw, vh) / Math.min(camS, 1) / 2 + Math.max(p.w, p.h);
      if (Math.abs(p.x) > reach || Math.abs(p.y) > reach) p.mode = 'gone';
    }
    const bob = p.mode === 'idle' ? Math.sin(t / 650 + p.phase) * 3 : 0;
    flag(p.el, 'is-gone', p.mode === 'gone');
    if (p.mode !== 'gone') put(p.el, 'transform', at(p.x - p.w / 2, p.y - p.h / 2 + bob, ` rotate(${p.rot.toFixed(2)}deg)`));
  }

  // ---------------- o quadro ----------------
  let t = 0;
  let lastNow = performance.now();
  let raf = 0;
  let measuredGlyphs = false;
  let planned = false;
  let ended = false;

  function update(dt: number) {
    // câmera
    const c = S.sampleCam(camKeys, t);
    camS = c.s;
    put(cam, 'transform', `scale(${c.s.toFixed(4)}) translate3d(${(-c.fx).toFixed(1)}px, ${(-c.fy).toFixed(1)}px, 0)`);

    flag(root, 'is-falling', t >= S.T.FALL_TEXT);
    // peças
    if (!measuredGlyphs && t >= S.T.FALL_TEXT - 100) {
      setupBodies();
      measuredGlyphs = true;
    }
    if (measuredGlyphs && t < S.T.LETTERS_GONE + 300) stepBodies(t, dt);
    flag(root, 'letters-gone', t >= S.T.LETTERS_GONE);

    // balões
    if (!popsMeasured && t >= S.T.POPUP - 150) measurePops();
    if (popsMeasured) {
      flag(p0.el, 'is-in', t >= S.T.POPUP && t < S.T.COLLAPSE[1]);
      flag(p0.el, 'is-loaded', t >= S.T.LOADED);
      const s1 = S.seg(t, S.T.SPLIT1[0], S.T.SPLIT1[1], S.ease.inOut);
      const s2 = S.seg(t, S.T.SPLIT2[0], S.T.SPLIT2[1], S.ease.inOut);
      flag(p1.el, 'is-in', t >= S.T.SPLIT1[0] + (S.T.SPLIT1[1] - S.T.SPLIT1[0]) * 0.8);
      flag(p2.el, 'is-in', t >= S.T.SPLIT2[0] + (S.T.SPLIT2[1] - S.T.SPLIT2[0]) * 0.8);
      const gooOn = (t > S.T.SPLIT1[0] - 50 && t < S.T.SPLIT1[1] + 120) || (t > S.T.SPLIT2[0] - 50 && t < S.T.SPLIT2[1] + 120);
      flag(goo, 'is-on', gooOn);
      if (gooOn) {
        put(g0, 'transform', at(p0.x - p0.w / 2, p0.y - p0.h / 2));
        const blob = (g: HTMLElement, from: Pop, to: Pt, size: Pop, p: number) => {
          const x = S.lerp(from.x, to.x, p);
          const y = S.lerp(from.y, to.y, p);
          const sc = S.lerp(0.4, 1, p);
          const stretch = 1 + Math.sin(Math.PI * p) * 0.22;
          put(g, 'transform', at(x - size.w / 2, y - size.h / 2, ` scale(${(sc * stretch).toFixed(3)}, ${(sc / stretch).toFixed(3)})`));
        };
        blob(g1, p0, spots.p1, p1, s1);
        blob(g2, p0, spots.p2, p2, s2);
      }

      // o balão do meio vira o ponto de partida da caixa
      if (t < S.T.COLLAPSE[0] || !L) {
        placePop(p0);
      } else {
        const k = S.seg(t, S.T.COLLAPSE[0], S.T.COLLAPSE[1], S.ease.in);
        const x = S.lerp(spots.p0.x, L.card.r, k);
        const y = S.lerp(spots.p0.y, L.card.t, k);
        put(p0.el, 'transform', at(x - p0.w / 2, y - p0.h / 2, ` scale(${S.lerp(1, 0.06, k).toFixed(3)})`));
      }
    }

    // plano da reconstrução
    if (!planned && t >= S.T.PLAN) {
      plan();
      planned = true;
    }
    if (L && tracks && pal) rebuild(dt);
    else if (popsMeasured) {
      if (t >= S.T.SPLIT1[1] - 200) stepPop(p1, t, dt);
      if (t >= S.T.SPLIT2[1] - 200) stepPop(p2, t, dt);
    }

    flag(root, 'is-reveal', t >= S.T.END);
  }

  function rebuild(dt: number) {
    const lay = L!;
    const tr = tracks!;
    const pl = pal!;

    // os ganchos do cursor B: no instante do agarrão, o balão pode ter sido empurrado
    for (const k of tr.b.keys) {
      if (k.tag === 'p1' && !fired.has('patch-p1') && t >= S.T.GRAB_P1[0] - 380) {
        fired.add('patch-p1');
        k.x = p1.x - p1.w * 0.2;
        k.y = p1.y;
      }
      if (k.tag === 'p2' && !fired.has('patch-p2') && t >= S.T.GRAB_P2[0] - 300) {
        fired.add('patch-p2');
        k.x = p2.x + p2.w * 0.15;
        k.y = p2.y - p2.h * 0.1;
      }
    }

    // cursores
    for (const cur of cursors) {
      const track = tr[cur.id];
      const p = S.sample(track.keys, t);
      cur.tip = { x: p.x, y: p.y };
      cur.z = p.z;
      if (cur.prev && dt > 0) {
        cur.v.x = cur.v.x * 0.75 + ((p.x - cur.prev.x) / dt) * 0.25;
        cur.v.y = cur.v.y * 0.75 + ((p.y - cur.prev.y) / dt) * 0.25;
      }
      cur.prev = { x: p.x, y: p.y };
      const on = t >= S.T.CURSORS_IN[0] && t < S.T.EXIT[1];
      flag(cur.el, 'is-on', on);
      const sc = 1 + 0.55 * p.z;
      put(cur.el, 'transform', at(p.x, p.y, ` scale(${sc.toFixed(3)})`));
      put(cur.el, 'zIndex', p.z > 0.2 ? '60' : p.z < -0.2 ? '24' : '45');
      put(cur.el, 'opacity', (p.z < 0 ? 1 + p.z * 0.4 : 1).toFixed(3));
      const pressed = track.press.some((iv) => S.within(iv, t));
      flag(cur.el, 'is-press', pressed);
      if (pressed && !cur.pressedBefore && on) ripple(cur.tip);
      cur.pressedBefore = pressed;
      const sp = Math.hypot(cur.v.x, cur.v.y) || 1;
      const look = Math.min(1, sp / 700) * 5;
      cur.eyes.style.transform = `translate(${((cur.v.x / sp) * look).toFixed(2)}px, ${((cur.v.y / sp) * look).toFixed(2)}px)`;
      // sombra: quanto mais perto da câmera, mais longe e mais espalhada ela cai sobre o que está embaixo
      const z = p.z;
      put(cur.sh, 'transform', at(p.x + 6 + z * 30, p.y + 10 + z * 40, ` scale(${(0.8 + z * 0.9).toFixed(3)})`));
      put(cur.sh, 'opacity', (on && z > -0.15 ? 0.14 + z * 0.3 : 0).toFixed(3));
    }
    const [A, B, C, D] = cursors;

    // a caixa: desenhada do canto de cima à direita até o de baixo à esquerda
    const card = lay.card;
    let bx: S.Rect = card;
    if (t < S.T.BOX[1]) {
      const corner = t >= S.T.BOX[0] ? A!.tip : { x: card.r, y: card.t };
      bx = { l: Math.min(card.r, corner.x), t: Math.min(card.t, corner.y), r: Math.max(card.r, corner.x), b: Math.max(card.t, corner.y) };
    }
    flag(box, 'is-on', t >= S.T.BOX[0]);
    if (t >= S.T.BOX[0]) {
      put(box, 'transform', at(bx.l, bx.t));
      put(box, 'width', `${Math.max(2, bx.r - bx.l).toFixed(1)}px`);
      put(box, 'height', `${Math.max(2, bx.b - bx.t).toFixed(1)}px`);
    }
    flag(box, 'is-filled', t >= S.T.PALETTE_CLICK);
    flag(seed, 'is-on', t >= S.T.COLLAPSE[1] - 80 && t < S.T.BOX[1] + 100);
    const sp = t >= S.T.BOX[0] && t < S.T.BOX[1] ? A!.tip : t >= S.T.BOX[1] ? { x: card.l, y: card.b } : { x: card.r, y: card.t };
    put(seed, 'transform', at(sp.x - 9, sp.y - 9));
    const inBox = (x: number, y: number) => t >= S.T.BOX[0] && x >= bx.l && x <= bx.r && y >= bx.t && y <= bx.b;

    // os balões: empurrados pela caixa, depois puxados para fora pelo cursor B
    // antes da caixa, os balões abrem espaço: o de cima vai para cima do cartão, o de baixo encosta no
    // canto de baixo à esquerda (onde a caixa vai passar e empurrá-lo)
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
        p.mode = 'held';
        Object.assign(p, grabOffset(p, B!.tip));
      }
      if (p.mode === 'held') {
        p.x = B!.tip.x + p.gx;
        p.y = B!.tip.y + p.gy;
        p.rot += (-10 - p.rot) * Math.min(1, dt * 6);
        if (t >= iv[1]) {
          p.mode = 'fly';
          p.vx = B!.v.x * 1.1 + Math.sign(p.x || 1) * 300;
          p.vy = B!.v.y * 1.1;
          p.vr = Math.sign(p.vx) * 380;
        }
      }
      stepPop(p, t, dt);
    }

    // paleta: C a abre, passa pelas cores e escolhe a do fundo
    flag(palEl, 'is-on', t >= S.T.PALETTE_OPEN && t < S.T.PALETTE_CLOSE);
    swatches.forEach((sw, i) => {
      const s = pl.swatches[i]!;
      flag(sw, 'is-hover', t < S.T.PALETTE_CLOSE && Math.hypot(C!.tip.x - s.x, C!.tip.y - s.y) < 15);
      flag(sw, 'is-picked', i === 4 && t >= S.T.PALETTE_CLICK);
    });
    flag(root, 'is-colored', t >= S.T.PALETTE_CLICK);
    for (const ct of tracks!.c.clicks) {
      const key = 'click-' + ct;
      if (!fired.has(key) && t >= ct) {
        fired.add(key);
        ripple(C!.tip);
      }
    }

    // logo: D busca o errado e o deixa no lugar, onde ele vira o certo
    const logoIv = S.T.LOGO;
    if (!phState.held && S.within(logoIv, t)) {
      phState.held = true;
      phState.gx = ph.x - D!.tip.x;
      phState.gy = ph.y - D!.tip.y;
    }
    flag(phEl, 'is-on', t >= S.T.CURSORS_IN[1] && t < logoIv[1]);
    const phPos = phState.held ? { x: D!.tip.x + phState.gx, y: D!.tip.y + phState.gy } : ph;
    const phRot = S.lerp(-14, 0, S.seg(t, logoIv[0], logoIv[1]));
    put(phEl, 'transform', at(phPos.x, phPos.y, ` translate(-50%, -50%) rotate(${phRot.toFixed(2)}deg)`));
    flag(logo, 'is-on', t >= logoIv[1]);

    // título: o errado aparece com a caixa, A o apaga, B digita o certo
    flag(wtitle, 'is-on', inBox(S.cx(lay.title), S.cy(lay.title)) || (t >= S.T.BOX[1] && t < S.T.ERASE[1] + 300));
    const erased = S.seg(t, S.T.ERASE[0], S.T.ERASE[1], S.ease.linear);
    wLetters.forEach((el, i) => flag(el, 'is-erased', (i + 0.5) / wLetters.length < erased));
    const typed = Math.floor(S.seg(t, S.T.TYPE[0], S.T.TYPE[1], S.ease.linear) * tLetters.length + 1e-6);
    tLetters.forEach((el, i) => flag(el, 'is-on', i < typed));
    const typing = t >= S.T.TYPE[0] && t < S.T.TYPE[1] + 250;
    tLetters.forEach((el, i) => flag(el, 'is-caret', typing && i === typed - 1));
    flag(sub, 'is-on', t >= S.T.SUBTITLE);

    // campos: D desenha cada um arrastando do canto de cima à esquerda
    const draw = (el: HTMLElement, iv: S.Interval, r: S.Rect, tip: Pt) => {
      const on = S.within(iv, t);
      flag(el, 'is-on', on);
      if (on) {
        const w = Math.max(4, tip.x - r.l);
        const h = Math.max(4, tip.y - r.t);
        put(el, 'transform', at(r.l, r.t));
        put(el, 'width', `${w.toFixed(1)}px`);
        put(el, 'height', `${h.toFixed(1)}px`);
      }
    };
    draw(drawE, S.T.EMAIL, lay.email, D!.tip);
    draw(drawP, S.T.PASS, lay.pass, D!.tip);
    flag(fieldE, 'is-on', t >= S.T.EMAIL[1]);
    flag(labelE, 'is-on', t >= S.T.EMAIL[1] + 80);
    flag(fieldP, 'is-on', t >= S.T.PASS[1]);
    flag(labelP, 'is-on', t >= S.T.PASS[1] + 80);

    // o campo que não devia existir: C o arrasta para fora
    if (cpfState.mode === 'idle' && S.within(S.T.CPF, t)) {
      cpfState.mode = 'held';
      cpfState.gx = cpfState.x - C!.tip.x;
      cpfState.gy = cpfState.y - C!.tip.y;
    }
    if (cpfState.mode === 'held') {
      cpfState.x = C!.tip.x + cpfState.gx;
      cpfState.y = C!.tip.y + cpfState.gy;
      cpfState.rot += (12 - cpfState.rot) * Math.min(1, dt * 5);
      if (t >= S.T.CPF[1]) {
        cpfState.mode = 'fly';
        cpfState.vy = Math.max(600, C!.v.y);
      }
    } else if (cpfState.mode === 'fly') {
      cpfState.vy += 2400 * dt;
      cpfState.y += cpfState.vy * dt;
      cpfState.rot += 200 * dt;
      if (cpfState.y > vh / camS) cpfState.mode = 'gone';
    }
    flag(cpf, 'is-on', cpfState.mode !== 'gone' && (inBox(S.cx(lay.button), S.cy(lay.button)) || t >= S.T.BOX[1]));
    put(cpf, 'transform', at(cpfState.x, cpfState.y, ` translate(-50%, -50%) rotate(${cpfState.rot.toFixed(2)}deg)`));

    // botão: C desenha e pinta
    draw(drawB, S.T.BUTTON, lay.button, C!.tip);
    flag(btn, 'is-on', t >= S.T.BUTTON[1]);
    flag(btn, 'is-painted', t >= S.T.PAINT);
    flag(backlink, 'is-on', t >= S.T.BACKLINK);

    // progresso
    const n = S.progressAt(t);
    flag(prog, 'is-on', t >= S.T.BOX[0] && t < S.T.EXIT[1]);
    flag(prog, 'is-full', n >= 100);
    const txt = String(n);
    if (progN.textContent !== txt) progN.textContent = txt;
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
  const w = window as unknown as { __entrarSeek?: (ms: number) => number };
  if (dev) {
    w.__entrarSeek = (ms: number) => {
      paused = true;
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
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    if (dev) delete w.__entrarSeek;
  };
}
