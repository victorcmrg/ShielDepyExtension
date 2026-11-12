// Roteiro da encenação do "Entrar" (decisão 0039, ditada pelo usuário): o 404 cai em pedaços 3D, a
// câmera aproxima, o ShielDepy detecta o erro num balão verde que se divide como líquido, e quatro
// cursores reconstroem a tela de login trabalhando juntos. Só números e funções puras (sem DOM): o
// motor (engine.ts) pergunta "onde está cada coisa no instante t" e o teste confere a ordem.
//
// Os trajetos passam por curvas suaves (spline de Hermite com a velocidade contínua): o cursor só
// para nos pontos marcados com `hold` (onde agarra, solta ou clica). Dois cursores fazem uma elipse
// em profundidade e passam gigantes na frente da câmera.

/** Os marcos, em milissegundos desde que a página abriu. */
export const T = {
  NOT_FOUND: 3000, // 404 parado na tela
  FALL_TEXT: 3000, // gravidade no "Página não encontrada"
  FALL_0: 3900,
  FALL_4A: 4350,
  FALL_4B: 4650,
  ZOOM: [5400, 8400] as const, // a câmera aproxima devagar
  LETTERS_GONE: 7900, // os pedaços já saíram do quadro
  POPUP: 8400,
  LOADED: 9600, // 1 s de carregamento
  SPLIT1: [9700, 10700] as const, // balão "ajustando rota", para a direita e para cima
  SPLIT2: [10900, 11900] as const, // balão "corrigindo tela de login", para a esquerda e para baixo
  PLAN: 12000, // mede a tela final e monta os trajetos
  COLLAPSE: [12100, 12700] as const, // o balão do meio vira o ponto de partida da caixa
  CAM_BACK: [12100, 13400] as const,
  CURSORS_IN: [12700, 13400] as const,
  ANCHOR: [13250, 14650] as const, // C segura o canto enquanto A puxa
  BOX: [13400, 14600] as const, // A desenha a caixa do canto de cima à direita ao de baixo à esquerda
  SLOTS: [14500, 15100] as const, // as partes pontilhadas: onde cada peça vai ficar
  GRAB_P1: [14500, 14900] as const, // B puxa os balões para fora
  LOGO: [14700, 15700] as const, // D carrega o logo para o lugar
  PALETTE_OPEN: 15000, // C abre a paleta e pensa bastante antes de escolher
  GRAB_P2: [15150, 15550] as const,
  ORBIT_B: [15600, 17000] as const, // B dá a volta e passa gigante na frente da câmera
  THINK_C1: [15950, 16600] as const,
  BUMP: 16000, // A e D se esbarram no meio do caminho
  SUB: [16150, 16800] as const, // A leva o subtítulo torto para o lugar
  PALETTE_CLICK: 16800,
  THINK_A: [16900, 17550] as const, // A olha o título errado antes de apagar
  EMAIL: [17000, 17600] as const, // D e C desenham os campos ao mesmo tempo
  PALETTE_CLOSE: 17150,
  PASS: [17300, 17900] as const,
  ERASE: [17600, 18500] as const, // A apaga o título errado...
  TYPE1: [17800, 18900] as const, // ...e B digita logo atrás, com um erro no fim
  CPF: [18100, 18550] as const, // C joga fora o campo que não devia estar ali
  BUTTON: [18300, 18900] as const, // D desenha o botão
  THINK_B: [18950, 19500] as const, // B percebe o erro
  THINK_C2: [19000, 19600] as const, // C pensa na cor do botão
  BACK: [19100, 20000] as const, // D traz o link de volta lá de cima
  BACKSPACE: [19500, 19800] as const,
  PAINT: 19700,
  TYPE2: [19850, 20200] as const,
  FOCUS_EMAIL: 20000, // C confere o foco de cada campo
  FOCUS_PASS: 20250,
  FONT_OPEN: 20300, // A abre as fontes, pensa e escolhe a do título
  ORBIT_D: [20300, 21700] as const, // D dá a volta gigante
  THINK_A2: [20350, 21000] as const,
  FONT_PICK: 21100,
  FONT_CLOSE: 21350,
  HIGH5: 22300, // os quatro se encontram em cima do cartão
  EXIT: [22500, 23200] as const,
  END: 23400,
  REVEAL: 400, // a tela de verdade entra por cima
} as const;

export type Ease = (p: number) => number;
export const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const ease = {
  linear: (p: number) => p,
  in: (p: number) => p * p * p,
  out: (p: number) => 1 - (1 - p) ** 3,
  inOut: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  inOutSine: (p: number) => -(Math.cos(Math.PI * p) - 1) / 2,
  // passa um pouco do ponto e volta (para "estalar" no lugar)
  back: (p: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
  },
} satisfies Record<string, Ease>;

/** Progresso (0 a 1, já com a curva) de t dentro do trecho [a, b]. */
export function seg(t: number, a: number, b: number, e: Ease = ease.inOut): number {
  return e(clamp01((t - a) / (b - a)));
}

/** Escala de um objeto na profundidade z (-1 fundo, 0 normal, 1 perto; 3,5 já é gigante). */
export const depthScale = (z: number) => Math.exp(0.45 * z);
/** A perspectiva da cena (px) e quanto um objeto na profundidade z sai do plano para ter aquela escala. */
export const PERSPECTIVE = 1100;
export const depthPx = (z: number) => PERSPECTIVE * (1 - 1 / depthScale(z));

/** Um ponto do trajeto: posição relativa ao centro da tela e profundidade. */
export interface Key {
  t: number;
  x: number;
  y: number;
  z: number;
  /** o cursor para aqui (velocidade zero): onde agarra, solta ou clica */
  hold?: boolean;
  /** o motor troca a posição pela do balão no instante do agarrão (o balão pode ter sido empurrado) */
  tag?: 'p1' | 'p2';
}

type Num3 = readonly number[];
const val = (k: Key): Num3 => [k.x, k.y, k.z];

/** Velocidade (por ms) no ponto i: média dos vizinhos, ou zero onde o cursor para. */
function tangent<K extends { t: number; hold?: boolean }>(keys: readonly K[], i: number, v: (k: K) => Num3): Num3 {
  const k = keys[i]!;
  if (k.hold || i === 0 || i === keys.length - 1) return v(k).map(() => 0);
  const a = keys[i - 1]!;
  const b = keys[i + 1]!;
  const dt = b.t - a.t || 1;
  const va = v(a);
  const vb = v(b);
  return va.map((x, j) => (vb[j]! - x) / dt);
}

/** Spline de Hermite pelos pontos: passa por todos, sem parar onde não há `hold`. */
function spline<K extends { t: number; hold?: boolean }>(keys: readonly K[], t: number, v: (k: K) => Num3): Num3 {
  const first = keys[0]!;
  if (t <= first.t) return v(first);
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      const dt = b.t - a.t || 1;
      const u = (t - a.t) / dt;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      const pa = v(a);
      const pb = v(b);
      const ma = tangent(keys, i - 1, v);
      const mb = tangent(keys, i, v);
      return pa.map((x, j) => h00 * x + h10 * ma[j]! * dt + h01 * pb[j]! + h11 * mb[j]! * dt);
    }
  }
  return v(keys[keys.length - 1]!);
}

export function sample(keys: readonly Key[], t: number): { x: number; y: number; z: number } {
  const [x = 0, y = 0, z = 0] = spline(keys, t, val);
  return { x, y, z };
}

export type Interval = readonly [number, number];
export const within = (iv: Interval, t: number) => t >= iv[0] && t < iv[1];

/** Câmera: escala e o ponto do mundo (relativo ao centro) que fica no meio da tela. */
export interface CamKey {
  t: number;
  s: number;
  fx: number;
  fy: number;
  /** inclinação da câmera em graus (o mundo gira em 3D em volta do centro da tela) */
  rx?: number;
  ry?: number;
  hold?: boolean;
}
const camVal = (k: CamKey): Num3 => [k.s, k.fx, k.fy, k.rx ?? 0, k.ry ?? 0];

export function sampleCam(keys: readonly CamKey[], t: number): { s: number; fx: number; fy: number; rx: number; ry: number } {
  const [s = 1, fx = 0, fy = 0, rx = 0, ry = 0] = spline(keys, t, camVal);
  return { s, fx, fy, rx, ry };
}

/** Retângulo relativo ao centro da tela. */
export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
export const cx = (r: Rect) => (r.l + r.r) / 2;
export const cy = (r: Rect) => (r.t + r.b) / 2;

/** Onde ficam os balões, a partir do tamanho da tela. */
export function balloonSpots(vw: number, vh: number) {
  const dx = Math.min(250, Math.max(60, vw * 0.2));
  const dy = Math.min(160, Math.max(110, vh * 0.17));
  return { p0: { x: 0, y: -10 }, p1: { x: dx, y: -10 - dy }, p2: { x: -dx, y: -10 + dy } };
}

/** A câmera até a volta ao normal (não depende da tela final). */
export function introCamera(vw: number, vh: number): CamKey[] {
  const { p1 } = balloonSpots(vw, vh);
  const near = vw < 600 ? 1.3 : 1.45;
  return [
    { t: 0, s: 1, fx: 0, fy: 0, hold: true },
    { t: T.ZOOM[0], s: 1, fx: 0, fy: 0, hold: true },
    { t: T.ZOOM[1], s: near, fx: 0, fy: 0, hold: true },
    { t: T.SPLIT1[0], s: near, fx: 0, fy: 0, hold: true },
    { t: T.SPLIT1[1] + 200, s: near - 0.2, fx: p1.x * 0.45, fy: (p1.y + 10) * 0.45 },
    { t: T.SPLIT2[1] + 200, s: near - 0.35, fx: 0, fy: 0, hold: true },
    { t: T.CAM_BACK[0], s: near - 0.35, fx: 0, fy: 0, hold: true },
    { t: T.CAM_BACK[1], s: 1, fx: 0, fy: 0, hold: true },
  ];
}

/** A tela de login pronta, medida (relativa ao centro). */
export interface Layout {
  vw: number;
  vh: number;
  card: Rect;
  logo: Rect;
  title: Rect;
  subtitle: Rect;
  emailLabel: Rect;
  email: Rect;
  passLabel: Rect;
  pass: Rect;
  button: Rect;
  back: Rect;
}

/** A paleta de cores que o cursor C abre: 5 amostras numa fileira. */
export const SWATCH = 28;
export const SWATCH_GAP = 8;
export const PALETTE_PAD = 10;
export const PALETTE_W = PALETTE_PAD * 2 + SWATCH * 5 + SWATCH_GAP * 4;
export function palette(L: Layout) {
  const x = Math.min(Math.max(L.card.r - 60, -L.vw / 2 + 12), L.vw / 2 - PALETTE_W - 12);
  const y = L.card.t + 64;
  const swatches = [0, 1, 2, 3, 4].map((i) => ({
    x: x + PALETTE_PAD + SWATCH / 2 + i * (SWATCH + SWATCH_GAP),
    y: y + PALETTE_PAD + SWATCH / 2,
  }));
  return { x, y, swatches };
}

/** As peças fora do lugar, antes de alguém levá-las: o logo errado, o subtítulo torto, o link lá em cima. */
export function misplaced(L: Layout) {
  return {
    logo: { x: Math.max(-L.vw / 2 + 80, -380), y: Math.max(-L.vh / 2 + 90, -260), rot: -14 },
    sub: { x: cx(L.card) - 26, y: cy(L.card) + 34, rot: 7 },
    back: { x: Math.min(cx(L.card) + 90, L.vw / 2 - 110), y: Math.max(L.card.t - 74, -L.vh / 2 + 60), rot: -6 },
  };
}

/** O ponto do esbarrão combinado entre A e D, e o ponto de encontro dos quatro no fim. */
export function meetingPoints(L: Layout) {
  return {
    bump: { x: cx(L.card) - Math.min(120, L.vw * 0.2), y: cy(L.card) - 10 },
    high5: { x: cx(L.card), y: L.card.t + 34 },
  };
}

/** Uma volta em elipse: perto da câmera embaixo (z alto, gigante), longe em cima (z baixo, pequeno). */
export function orbit(o: { t0: number; t1: number; x: number; y: number; rx: number; ry: number; zMid: number; zAmp: number; from: number; dir: 1 | -1 }): Key[] {
  const n = 8;
  const keys: Key[] = [];
  for (let i = 0; i <= n; i++) {
    const th = o.from + o.dir * ((Math.PI * 2 * i) / n);
    keys.push({
      t: o.t0 + ((o.t1 - o.t0) * i) / n,
      x: o.x + o.rx * Math.cos(th),
      y: o.y + o.ry * Math.sin(th),
      z: o.zMid + o.zAmp * Math.sin(th),
    });
  }
  return keys;
}

export type CursorId = 'a' | 'b' | 'c' | 'd';
export interface Track {
  keys: Key[];
  /** intervalos com o botão apertado (arrastando ou segurando) */
  press: Interval[];
  /** cliques (marca na tela) */
  clicks: number[];
  /** momentos em que o cursor para e pensa (balão de "…", olhos procurando) */
  think: Interval[];
}

const k = (t: number, x: number, y: number, z: number, hold = false): Key => (hold ? { t, x, y, z, hold } : { t, x, y, z });

/** Pensando perto de um ponto: chega, fica rondando devagar (pequenas voltas) e para no fim. */
function ponder(t0: number, t1: number, x: number, y: number, z: number, r = 10): Key[] {
  const n = 4;
  const keys: Key[] = [];
  for (let i = 0; i <= n; i++) {
    const a = i * 2.2;
    keys.push(k(lerp(t0, t1, i / n), x + Math.cos(a) * r * (i % 2 ? 1 : 0.4), y + Math.sin(a) * r * 0.6, z + (i % 2 ? 0.04 : 0), i === 0 || i === n));
  }
  return keys;
}

export const TITLE_WRONG = 'Entarr na cnota';
export const TITLE = 'Entrar na conta';
/** O que B digita primeiro, com as três últimas letras trocadas (ele percebe, apaga e corrige). */
export const TITLE_TYPO = 'Entrar na cotna';
const FIX_FROM = TITLE.length - 3;

/** O instante (ms) em que cada letra do primeiro trecho entra: ritmo irregular, com pausa depois de "Entrar". */
function typeTimes(): number[] {
  const w = TITLE_TYPO.split('').map((ch, i) => (ch === ' ' ? 2.6 : 1 + 0.55 * Math.sin(i * 2.3)));
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return w.map((x) => {
    acc += x;
    return T.TYPE1[0] + ((T.TYPE1[1] - T.TYPE1[0]) * acc) / total;
  });
}
const TYPE_TIMES = typeTimes();

/** O título que está escrito no instante t (B digita, erra, apaga e corrige). */
export function titleText(t: number): string {
  if (t < T.TYPE1[0]) return '';
  if (t < T.BACKSPACE[0]) return TITLE_TYPO.slice(0, TYPE_TIMES.filter((x) => x <= t).length);
  if (t < T.TYPE2[0]) {
    const gone = Math.min(3, Math.floor(seg(t, T.BACKSPACE[0], T.BACKSPACE[1], ease.linear) * 3 + 1e-6));
    return TITLE_TYPO.slice(0, TITLE_TYPO.length - gone);
  }
  const typed = Math.min(3, Math.floor(seg(t, T.TYPE2[0], T.TYPE2[1], ease.linear) * 3 + 1e-6));
  return TITLE.slice(0, FIX_FROM + typed);
}

/** O seletor de fontes que A abre ao lado do título: serifada, mono e a da marca. */
export const FONT_OPT_W = 52;
export const FONT_OPT_H = 40;
export const FONT_GAP = 6;
export const FONT_PAD = 8;
export const FONT_W = FONT_PAD * 2 + FONT_OPT_W * 3 + FONT_GAP * 2;
export function fontPicker(L: Layout) {
  const x = Math.min(Math.max(L.title.r + 18, -L.vw / 2 + 12), L.vw / 2 - FONT_W - 12);
  const y = L.title.t - 64;
  const opts = [0, 1, 2].map((i) => ({ x: x + FONT_PAD + FONT_OPT_W / 2 + i * (FONT_OPT_W + FONT_GAP), y: y + FONT_PAD + FONT_OPT_H / 2 }));
  return { x, y, opts };
}

/** Os trajetos dos quatro cursores, a partir da tela final medida. */
export function cursorTracks(L: Layout): Record<CursorId, Track> {
  const { vw, vh, card, title, email, pass, button, logo, back, subtitle } = L;
  const W = vw / 2 + 80;
  const H = vh / 2 + 80;
  const spots = balloonSpots(vw, vh);
  const pal = palette(L);
  const mis = misplaced(L);
  const meet = meetingPoints(L);
  const fonts = fontPicker(L);
  const sw = pal.swatches;
  const tw = title.r - title.l;
  const caretX = (n: number) => title.l + (tw * n) / TITLE.length;

  // A: puxa a caixa, esbarra em D, endireita o subtítulo, pensa e apaga o título, escolhe a fonte
  const zig: Key[] = [];
  const passes = 7;
  for (let i = 1; i <= passes; i++) {
    const p = i / passes;
    zig.push(k(T.ERASE[0] + (T.ERASE[1] - T.ERASE[0]) * p, lerp(title.l, title.r, p) + (i % 2 ? 16 : -16), cy(title) + (i % 2 ? -7 : 7), 0.2, i === passes));
  }
  const f = fonts.opts;
  const a: Track = {
    keys: [
      k(T.CURSORS_IN[0], W, H, -1),
      k(T.BOX[0] - 150, card.r + 30, card.t + 40, -0.1),
      k(T.BOX[0], card.r, card.t, 0, true),
      k(lerp(T.BOX[0], T.BOX[1], 0.55), lerp(card.r, card.l, 0.62), lerp(card.t, card.b, 0.5), 0.15),
      k(T.BOX[1], card.l, card.b, 0.1, true),
      k(T.BOX[1] + 500, card.l - 70, card.b - 30, -0.4),
      k(T.BUMP - 250, meet.bump.x - 90, meet.bump.y + 60, -0.05),
      k(T.BUMP, meet.bump.x, meet.bump.y, 0),
      k(T.SUB[0], mis.sub.x, mis.sub.y, 0.05, true),
      k(lerp(T.SUB[0], T.SUB[1], 0.5), lerp(mis.sub.x, cx(subtitle), 0.5) - 30, lerp(mis.sub.y, cy(subtitle), 0.5), 0.8),
      k(T.SUB[1], cx(subtitle), cy(subtitle), 0.05, true),
      ...ponder(T.THINK_A[0], T.THINK_A[1], title.l - 26, cy(title) - 34, 0.1, 12),
      k(T.ERASE[0], title.l, cy(title), 0.2, true),
      ...zig,
      k(T.ERASE[1] + 500, title.l - 60, cy(title) + 70, -0.5),
      k(T.FONT_OPEN - 200, fonts.x - 24, fonts.y + 30, 0.1),
      k(T.FONT_OPEN, fonts.x - 10, fonts.y + 20, 0.1, true),
      k(T.THINK_A2[0] + 100, f[0]!.x, f[0]!.y, 0.15, true),
      k(T.THINK_A2[0] + 300, f[0]!.x + 4, f[0]!.y + 3, 0.15),
      k(lerp(T.THINK_A2[0], T.THINK_A2[1], 0.55), f[1]!.x, f[1]!.y, 0.18, true),
      k(T.THINK_A2[1], f[1]!.x + 14, f[1]!.y - 4, 0.15),
      k(T.FONT_PICK, f[2]!.x, f[2]!.y, 0.2, true),
      k(T.FONT_CLOSE + 300, card.r + 50, card.t + 30, -0.2),
      k(T.HIGH5 - 400, meet.high5.x - 70, meet.high5.y + 40, 0),
      k(T.HIGH5, meet.high5.x - 16, meet.high5.y + 4, 0.1),
      k(T.EXIT[0], card.r - 30, card.t - 10, 0),
      k(T.EXIT[1], W, H, -1),
    ],
    press: [T.BOX, T.SUB, T.ERASE, [T.FONT_OPEN - 30, T.FONT_OPEN + 80], [T.FONT_PICK - 30, T.FONT_PICK + 90]],
    clicks: [T.FONT_OPEN, T.FONT_PICK],
    think: [T.THINK_A, T.THINK_A2],
  };

  // B: puxa os balões para fora vindo para perto da câmera, dá a volta gigante, digita, erra e corrige
  const typeKeys: Key[] = [0.25, 0.5, 0.75].map((p) => k(lerp(T.TYPE1[0], T.TYPE1[1], p), caretX(TITLE.length * p) + 4, cy(title) + 16 + (p === 0.5 ? -3 : 2), 0.05));
  const b: Track = {
    keys: [
      k(T.CURSORS_IN[0], -W, -H, -1),
      k(T.CURSORS_IN[1], -card.r * 0.5, -vh * 0.3, -0.3),
      k(T.GRAB_P1[0] - 350, spots.p1.x - 70, spots.p1.y - 60, 0.9),
      { ...k(T.GRAB_P1[0], spots.p1.x, spots.p1.y, 1.1, true), tag: 'p1' },
      k(T.GRAB_P1[1], W - 40, -H + 30, 1.1),
      { ...k(T.GRAB_P2[0], spots.p2.x, spots.p2.y, 0.9, true), tag: 'p2' },
      k(T.GRAB_P2[1], -W + 40, spots.p2.y + 60, 0.9),
      ...orbit({ t0: T.ORBIT_B[0], t1: T.ORBIT_B[1] - 200, x: 0, y: cy(card) + 40, rx: Math.min(vw * 0.36, 430), ry: 90, zMid: 0.8, zAmp: 2.8, from: Math.PI, dir: 1 }),
      k(T.TYPE1[0] - 400, title.l - 40, cy(title) + 50, -0.2),
      k(T.TYPE1[0], caretX(0), cy(title) + 16, 0.05, true),
      ...typeKeys,
      k(T.TYPE1[1], caretX(TITLE.length), cy(title) + 16, 0.05, true),
      ...ponder(T.THINK_B[0], T.THINK_B[1], caretX(TITLE.length) + 10, cy(title) + 26, 0.1, 9),
      k(T.BACKSPACE[1], caretX(FIX_FROM), cy(title) + 16, 0.05, true),
      k(T.TYPE2[1], caretX(TITLE.length), cy(title) + 16, 0.05, true),
      k(T.TYPE2[1] + 600, card.l - 60, cy(card) - 40, -0.3),
      k(T.HIGH5 - 600, card.l + 20, card.t - 40, -0.2),
      k(T.HIGH5, meet.high5.x - 2, meet.high5.y - 22, 0.1),
      k(T.EXIT[0], card.l + 40, card.t - 30, 0),
      k(T.EXIT[1], -W, -H, -1),
    ],
    press: [T.GRAB_P1, T.GRAB_P2],
    clicks: [],
    think: [T.THINK_B],
  };

  // C: segura o canto, pensa muito antes de escolher a cor, desenha a senha, joga fora o CPF,
  // pensa na cor do botão e o pinta, confere o foco dos campos
  const c: Track = {
    keys: [
      k(T.CURSORS_IN[0], W, 0, -1),
      k(T.ANCHOR[0], card.r + 14, card.t - 14, 0, true),
      k(T.ANCHOR[1], card.r + 14, card.t - 14, 0, true),
      k(T.PALETTE_OPEN - 50, pal.x - 26, pal.y + 12, 0.1, true),
      k(T.PALETTE_OPEN + 300, sw[0]!.x, sw[0]!.y, 0.2, true),
      k(T.PALETTE_OPEN + 650, sw[1]!.x, sw[1]!.y + 2, 0.2, true),
      k(T.THINK_C1[0], sw[2]!.x, sw[2]!.y, 0.22, true),
      k(lerp(T.THINK_C1[0], T.THINK_C1[1], 0.5), sw[2]!.x - 5, sw[2]!.y + 4, 0.24),
      k(T.THINK_C1[1], sw[3]!.x, sw[3]!.y - 2, 0.22, true),
      k(T.PALETTE_CLICK, sw[4]!.x, sw[4]!.y, 0.25, true),
      k(T.PALETTE_CLOSE + 50, pass.l - 50, pass.t + 40, 0),
      k(T.PASS[0], pass.l, pass.t, 0, true),
      k(T.PASS[1], pass.r, pass.b, 0.05, true),
      k(T.CPF[0], cx(button) + 24, cy(button), 0.3, true),
      k(T.CPF[1], cx(button) + 70, H + 60, 0.6),
      ...ponder(T.THINK_C2[0], T.THINK_C2[1], button.r + 30, cy(button) + 20, 0.05, 12),
      k(T.PAINT, cx(button) + 30, cy(button), 0.1, true),
      k(T.FOCUS_EMAIL, cx(email) + 40, cy(email), 0.1, true),
      k(T.FOCUS_PASS, cx(pass) + 40, cy(pass), 0.1, true),
      k(T.FOCUS_PASS + 600, card.r + 70, card.b - 40, -0.3),
      k(T.HIGH5 - 500, meet.high5.x + 80, meet.high5.y + 50, 0),
      k(T.HIGH5, meet.high5.x + 16, meet.high5.y + 4, 0.1),
      k(T.EXIT[0], card.r + 20, cy(card), 0),
      k(T.EXIT[1], W, 0, -1),
    ],
    press: [
      T.ANCHOR,
      T.PASS,
      T.CPF,
      [T.PALETTE_CLICK - 30, T.PALETTE_CLICK + 90],
      [T.PAINT - 30, T.PAINT + 90],
      [T.FOCUS_EMAIL - 30, T.FOCUS_EMAIL + 70],
      [T.FOCUS_PASS - 30, T.FOCUS_PASS + 70],
    ],
    clicks: [T.PALETTE_CLICK, T.PAINT, T.FOCUS_EMAIL, T.FOCUS_PASS],
    think: [[T.PALETTE_OPEN + 250, T.PALETTE_CLICK - 60], T.THINK_C2],
  };

  // D: carrega o logo (levantando perto da câmera), esbarra em A, desenha o e-mail e o botão,
  // traz o link de volta lá de cima e dá a volta gigante
  const midLogo = { x: lerp(mis.logo.x, cx(logo), 0.5), y: Math.min(mis.logo.y, cy(logo)) - 50 };
  const d: Track = {
    keys: [
      k(T.CURSORS_IN[0], -W, vh * 0.2, -1),
      k(T.CURSORS_IN[1], -vw * 0.3, vh * 0.22, -0.4),
      k(T.LOGO[0] - 300, mis.logo.x - 30, mis.logo.y + 30, 0.1),
      k(T.LOGO[0], mis.logo.x, mis.logo.y, 0.25, true),
      k(lerp(T.LOGO[0], T.LOGO[1], 0.5), midLogo.x, midLogo.y, 1.2),
      k(T.LOGO[1], cx(logo), cy(logo), 0.25, true),
      k(T.BUMP - 150, meet.bump.x + 60, meet.bump.y - 70, 0.05),
      k(T.BUMP, meet.bump.x, meet.bump.y, 0),
      k(T.EMAIL[0] - 300, email.l - 40, email.t - 30, -0.1),
      k(T.EMAIL[0], email.l, email.t, 0, true),
      k(T.EMAIL[1], email.r, email.b, 0.05, true),
      k(T.BUTTON[0], button.l, button.t, 0, true),
      k(T.BUTTON[1], button.r, button.b, 0.05, true),
      k(T.BACK[0] - 150, mis.back.x - 50, mis.back.y + 30, 0.3),
      k(T.BACK[0], mis.back.x, mis.back.y, 0.2, true),
      k(lerp(T.BACK[0], T.BACK[1], 0.5), lerp(mis.back.x, cx(back), 0.5) + 130, lerp(mis.back.y, cy(back), 0.5), 1.3),
      k(T.BACK[1], cx(back), cy(back), 0.2, true),
      ...orbit({ t0: T.ORBIT_D[0], t1: T.ORBIT_D[1], x: 0, y: cy(card) - 20, rx: Math.min(vw * 0.38, 450), ry: 110, zMid: 0.9, zAmp: 2.7, from: 0, dir: -1 }),
      k(T.HIGH5 - 300, meet.high5.x + 40, meet.high5.y - 60, 0),
      k(T.HIGH5, meet.high5.x + 2, meet.high5.y + 26, 0.1),
      k(T.EXIT[0], card.l + 10, card.b - 30, 0),
      k(T.EXIT[1], -W, vh * 0.2, -1),
    ],
    press: [T.LOGO, T.EMAIL, T.BUTTON, T.BACK],
    clicks: [],
    think: [],
  };

  return { a, b, c, d };
}

/** A câmera durante a reconstrução: abre e inclina em 3D quando há muito acontecendo, aproxima nos consertos. */
export function rebuildCamera(L: Layout): CamKey[] {
  const { title, button, card } = L;
  const pal = palette(L);
  const fonts = fontPicker(L);
  const near = L.vw < 600 ? 1.1 : 1.22;
  return [
    { t: T.BOX[0], s: 1, fx: 0, fy: 0, hold: true },
    { t: T.BOX[1], s: 0.95, fx: 0, fy: 0, rx: 7, ry: -9 },
    { t: T.GRAB_P2[1], s: 0.9, fx: 0, fy: 0, rx: 4, ry: 11 },
    { t: T.PALETTE_CLICK, s: 1.08, fx: (pal.x + PALETTE_W / 2) * 0.5, fy: pal.y * 0.5, rx: -5, ry: 7 },
    { t: T.ERASE[0], s: near, fx: cx(title) * 0.7, fy: cy(title) * 0.7, rx: 2, ry: -6 },
    { t: T.THINK_B[0], s: near + 0.04, fx: cx(title) * 0.7, fy: cy(title) * 0.7, rx: 0, ry: 3 },
    { t: T.PAINT, s: 1.0, fx: cx(button) * 0.3, fy: cy(button) * 0.3, rx: 6, ry: -5 },
    { t: T.TYPE2[1], s: near, fx: cx(title) * 0.6, fy: cy(title) * 0.6, rx: 0, ry: 0 },
    { t: T.FONT_PICK, s: near, fx: (title.r + fonts.x) * 0.3, fy: cy(title) * 0.6, rx: -3, ry: 5 },
    { t: T.ORBIT_D[1], s: 0.96, fx: 0, fy: 0, rx: 6, ry: -4 },
    { t: T.HIGH5, s: 1.1, fx: cx(card) * 0.5, fy: (card.t + 34) * 0.5, rx: -3, ry: 0 },
    { t: T.EXIT[1] - 100, s: 1, fx: 0, fy: 0, rx: 0, ry: 0, hold: true },
  ];
}

/** Quanto da tela já foi reconstruído (0 a 100), pelos marcos. */
const PROGRESS: readonly (readonly [number, number])[] = [
  [T.BOX[0], 0],
  [T.BOX[1], 10],
  [T.GRAB_P2[1], 18],
  [T.LOGO[1], 26],
  [T.SUB[1], 33],
  [T.PALETTE_CLICK + 300, 40],
  [T.PASS[1], 50],
  [T.ERASE[1], 56],
  [T.BUTTON[1], 64],
  [T.PAINT + 200, 72],
  [T.BACK[1], 78],
  [T.TYPE2[1], 86],
  [T.FONT_PICK + 200, 94],
  [T.HIGH5, 100],
];
export function progressAt(t: number): number {
  if (t <= PROGRESS[0]![0]) return 0;
  for (let i = 1; i < PROGRESS.length; i++) {
    const [tb, vb] = PROGRESS[i]!;
    if (t <= tb) {
      const [ta, va] = PROGRESS[i - 1]!;
      return Math.round(lerp(va, vb, (t - ta) / (tb - ta)));
    }
  }
  return 100;
}
