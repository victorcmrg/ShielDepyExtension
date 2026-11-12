// Física das letras e dos números que caem (decisão 0039): gravidade, quique no chão com um empurrão
// para o lado, atrito, e o tombo em 3D ao tocar o chão (a peça gira em torno da base até deitar).
// Puro, sem DOM: o motor só lê x, y e os ângulos para montar o transform.

export const GRAVITY = 2800; // px/s²

export interface Body {
  /** base da peça (meio de baixo), relativa ao centro da tela */
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** giro no plano da tela (no ar), em graus */
  spin: number;
  vspin: number;
  /** guinada em torno do eixo vertical depois de cair (as peças deitam viradas para lados diferentes) */
  yaw: number;
  yawTarget: number;
  /** tombo em torno do eixo horizontal da base: 0 em pé, ±90 deitada */
  tip: number;
  vtip: number;
  tipTarget: number;
  /** quanto a peça devolve do impacto (0 a 1) */
  rest: number;
  /** empurrão para o lado no primeiro impacto (px/s, com sinal) */
  kick: number;
  /** quando a gravidade começa (ms) */
  start: number;
  active: boolean;
  landed: boolean;
  tipped: boolean;
  asleep: boolean;
  /** a força do toque no chão mais forte desde a última leitura (px/s): quiques e o tombo ao deitar.
   * Quem lê (o som) zera. */
  hit: number;
}

export function makeBody(
  x: number,
  y: number,
  w: number,
  h: number,
  o: { start: number; rest: number; kick: number; tipTarget: number; yawTarget: number; vspin: number }
): Body {
  return {
    x,
    y,
    w,
    h,
    vx: 0,
    vy: 0,
    spin: 0,
    vspin: o.vspin,
    yaw: 0,
    yawTarget: o.yawTarget,
    tip: 0,
    vtip: 0,
    tipTarget: o.tipTarget,
    rest: o.rest,
    kick: o.kick,
    start: o.start,
    active: false,
    landed: false,
    tipped: false,
    asleep: false,
    hit: 0,
  };
}

/**
 * Um passo de `dt` segundos. Devolve 'impact' no primeiro toque no chão com força (para as peças
 * grandes empurrarem as pequenas em volta).
 */
export function stepBody(b: Body, dt: number, now: number, floor: number, wallL: number, wallR: number): 'impact' | null {
  if (!b.active) {
    if (now < b.start) return null;
    b.active = true;
  }
  if (b.asleep) return null;
  let event: 'impact' | null = null;

  // no ar
  b.vy += GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.spin += b.vspin * dt;

  // paredes
  const half = b.w / 2;
  if (b.x - half < wallL) {
    b.x = wallL + half;
    b.vx = Math.abs(b.vx) * 0.5;
  } else if (b.x + half > wallR) {
    b.x = wallR - half;
    b.vx = -Math.abs(b.vx) * 0.5;
  }

  // chão
  if (b.y >= floor) {
    b.y = floor;
    const speed = b.vy;
    if (speed > 140) {
      b.hit = Math.max(b.hit, speed);
      b.vy = -speed * b.rest;
      if (!b.landed) {
        b.landed = true;
        b.vx += b.kick;
        if (speed > 600) event = 'impact';
      } else {
        b.vx *= 0.75;
      }
      b.vspin *= 0.45;
    } else {
      b.vy = 0;
    }
    if (!b.tipped) b.tipped = true;
  }

  const onFloor = b.y >= floor - 0.5 && Math.abs(b.vy) < 1;
  if (onFloor) {
    b.vx *= Math.exp(-5 * dt);
    // assenta na base: o giro de ar vai a zero
    b.spin += (0 - b.spin) * Math.min(1, dt * 10);
    b.vspin = 0;
  }

  // o tombo: acelera como algo caindo (mais rápido quanto mais inclinado) e quica um pouco ao deitar
  if (b.tipped) {
    const dir = Math.sign(b.tipTarget) || 1;
    const lean = Math.abs(Math.sin((b.tip * Math.PI) / 180));
    b.vtip += dir * (700 + 2600 * lean) * dt;
    b.tip += b.vtip * dt;
    if ((dir > 0 && b.tip >= b.tipTarget) || (dir < 0 && b.tip <= b.tipTarget)) {
      b.tip = b.tipTarget;
      // a ponta de cima bate no chão com a velocidade do giro vezes a altura
      b.hit = Math.max(b.hit, ((Math.abs(b.vtip) * Math.PI) / 180) * b.h * 0.6);
      b.vtip = -b.vtip * 0.28;
      if (Math.abs(b.vtip) < 25) b.vtip = 0;
    }
    b.yaw += (b.yawTarget - b.yaw) * Math.min(1, dt * 4);
  }

  if (onFloor && b.tipped && b.vtip === 0 && b.tip === b.tipTarget && Math.abs(b.vx) < 2) b.asleep = true;
  return event;
}

/** Uma peça grande caiu perto: as pequenas em volta pulam para longe dela. */
export function kickAround(src: Body, bodies: readonly Body[], rand: () => number): void {
  for (const o of bodies) {
    if (o === src || !o.active) continue;
    const dx = o.x - src.x;
    if (Math.abs(dx) > src.w * 0.8) continue;
    o.asleep = false;
    o.vy = -(450 + rand() * 450);
    o.vx += Math.sign(dx || 1) * (180 + rand() * 300);
    o.vspin = (rand() - 0.5) * 500;
    o.tipTarget = -o.tipTarget;
  }
}

/** Gerador pseudoaleatório com semente: a mesma queda toda vez (e no teste). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
