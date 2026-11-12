// Roteiro da encenação do "Entrar" (decisão 0039, segunda versão, ditada pelo usuário): o 404 cai em
// pedaços 3D, a câmera aproxima, o ShielDepy detecta o erro num balão verde que se divide como
// líquido, e quatro cursores reconstroem a tela de login. Só números e funções puras (sem DOM): o
// motor (engine.ts) pergunta "onde está cada coisa no instante t" e o teste confere a ordem.

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
  CURSORS_IN: [12800, 13400] as const,
  BOX: [13400, 14600] as const, // A desenha a caixa do canto de cima à direita ao de baixo à esquerda
  GRAB_P1: [14600, 15000] as const, // B puxa os balões para fora
  GRAB_P2: [15300, 15700] as const,
  PALETTE_OPEN: 15800,
  PALETTE_CLICK: 16450, // C escolhe a cor do fundo
  PALETTE_CLOSE: 16900,
  LOGO: [16900, 17600] as const, // D arrasta o logo para o lugar
  ERASE: [17700, 18600] as const, // A apaga o título errado
  TYPE: [18600, 19300] as const, // B digita o certo
  SUBTITLE: 19200,
  EMAIL: [19300, 19900] as const, // D desenha os campos
  PASS: [19950, 20550] as const,
  CPF: [20400, 20850] as const, // C joga fora o campo que não devia estar ali
  BUTTON: [21000, 21500] as const, // C desenha o botão
  PAINT: 21600, // e pinta com a cor da marca
  BACKLINK: 22000,
  EXIT: [22100, 22800] as const, // os cursores vão embora
  END: 23000,
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

/** Um ponto do trajeto: posição relativa ao centro da tela e profundidade (-1 fundo, 0 normal, 1 perto). */
export interface Key {
  t: number;
  x: number;
  y: number;
  z: number;
  e?: Ease;
  /** o motor troca a posição pela do balão no instante do agarrão (o balão pode ter sido empurrado) */
  tag?: 'p1' | 'p2';
}

export function sample(keys: readonly Key[], t: number): { x: number; y: number; z: number } {
  const first = keys[0]!;
  if (t <= first.t) return { x: first.x, y: first.y, z: first.z };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      const p = (b.e ?? ease.inOut)(clamp01((t - a.t) / (b.t - a.t || 1)));
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: lerp(a.z, b.z, p) };
    }
  }
  const last = keys[keys.length - 1]!;
  return { x: last.x, y: last.y, z: last.z };
}

export type Interval = readonly [number, number];
export const within = (iv: Interval, t: number) => t >= iv[0] && t < iv[1];

/** Câmera: escala e o ponto do mundo (relativo ao centro) que fica no meio da tela. */
export interface CamKey {
  t: number;
  s: number;
  fx: number;
  fy: number;
  e?: Ease;
}

export function sampleCam(keys: readonly CamKey[], t: number): { s: number; fx: number; fy: number } {
  const first = keys[0]!;
  if (t <= first.t) return { s: first.s, fx: first.fx, fy: first.fy };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      const p = (b.e ?? ease.inOut)(clamp01((t - a.t) / (b.t - a.t || 1)));
      return { s: lerp(a.s, b.s, p), fx: lerp(a.fx, b.fx, p), fy: lerp(a.fy, b.fy, p) };
    }
  }
  const last = keys[keys.length - 1]!;
  return { s: last.s, fx: last.fx, fy: last.fy };
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
    { t: 0, s: 1, fx: 0, fy: 0 },
    { t: T.ZOOM[0], s: 1, fx: 0, fy: 0 },
    { t: T.ZOOM[1], s: near, fx: 0, fy: 0, e: ease.inOutSine },
    { t: T.SPLIT1[0], s: near, fx: 0, fy: 0 },
    { t: T.SPLIT1[1] + 200, s: near - 0.2, fx: p1.x * 0.45, fy: (p1.y + 10) * 0.45 },
    { t: T.SPLIT2[1] + 200, s: near - 0.35, fx: 0, fy: 0 },
    { t: T.CAM_BACK[0], s: near - 0.35, fx: 0, fy: 0 },
    { t: T.CAM_BACK[1], s: 1, fx: 0, fy: 0 },
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

/** Onde o logo errado está antes do cursor D buscá-lo. */
export function logoPlaceholder(L: Layout) {
  return { x: Math.max(-L.vw / 2 + 80, -380), y: Math.max(-L.vh / 2 + 90, -260) };
}

export type CursorId = 'a' | 'b' | 'c' | 'd';
export interface Track {
  keys: Key[];
  /** intervalos com o botão apertado (arrastando) */
  press: Interval[];
  /** cliques (marca na tela) */
  clicks: number[];
}

/** Os trajetos dos quatro cursores, a partir da tela final medida. */
export function cursorTracks(L: Layout): Record<CursorId, Track> {
  const { vw, vh, card, title, email, pass, button, logo } = L;
  const W = vw / 2 + 80;
  const H = vh / 2 + 80;
  const spots = balloonSpots(vw, vh);
  const pal = palette(L);
  const ph = logoPlaceholder(L);

  // A: desenha a caixa, depois vira borracha no título errado
  const zig: Key[] = [];
  const passes = 6;
  for (let i = 1; i <= passes; i++) {
    const p = i / passes;
    zig.push({
      t: T.ERASE[0] + (T.ERASE[1] - T.ERASE[0]) * p,
      x: lerp(title.l, title.r, p) + (i % 2 ? 18 : -18),
      y: cy(title) + (i % 2 ? -7 : 7),
      z: 0.25,
      e: ease.inOutSine,
    });
  }
  const a: Track = {
    keys: [
      { t: T.CURSORS_IN[0], x: W, y: H, z: -1 },
      { t: T.BOX[0] - 120, x: card.r + 8, y: card.t - 8, z: 0, e: ease.out },
      { t: T.BOX[0], x: card.r, y: card.t, z: 0 },
      { t: T.BOX[1], x: card.l, y: card.b, z: 0.1, e: ease.inOut },
      { t: T.BOX[1] + 700, x: card.l - 50, y: card.b + 20, z: -0.7 },
      { t: T.ERASE[0] - 300, x: title.l - 30, y: cy(title), z: -0.2 },
      { t: T.ERASE[0], x: title.l, y: cy(title), z: 0.25 },
      ...zig,
      { t: T.ERASE[1] + 500, x: title.r + 70, y: cy(title) + 60, z: -0.5 },
      { t: T.EXIT[0], x: card.r + 40, y: card.b - 40, z: -0.4 },
      { t: T.EXIT[1], x: W, y: H, z: -1, e: ease.in },
    ],
    press: [T.BOX, T.ERASE],
    clicks: [],
  };

  // B: vem para perto da câmera (grande, com sombra), arrasta os balões para fora; depois digita o título
  const b: Track = {
    keys: [
      { t: T.CURSORS_IN[0], x: -W, y: -H, z: -1 },
      { t: T.CURSORS_IN[1], x: -card.r * 0.5, y: -vh * 0.3, z: -0.3 },
      { t: T.GRAB_P1[0] - 400, x: spots.p1.x - 60, y: spots.p1.y - 50, z: 0.85 },
      { t: T.GRAB_P1[0], x: spots.p1.x, y: spots.p1.y, z: 0.9, tag: 'p1' },
      { t: T.GRAB_P1[1], x: W - 40, y: -H + 30, z: 0.9, e: ease.in },
      { t: T.GRAB_P2[0], x: spots.p2.x, y: spots.p2.y, z: 0.7, tag: 'p2' },
      { t: T.GRAB_P2[1], x: -W + 30, y: spots.p2.y + 70, z: 0.7, e: ease.in },
      { t: T.GRAB_P2[1] + 600, x: -card.r * 0.3, y: card.t + 30, z: -0.4 },
      { t: T.TYPE[0], x: title.l - 4, y: cy(title) + 14, z: 0 },
      { t: T.TYPE[1], x: title.r + 4, y: cy(title) + 14, z: 0.1, e: ease.linear },
      { t: T.TYPE[1] + 600, x: card.l - 50, y: cy(card), z: -0.5 },
      { t: T.EXIT[0], x: card.l - 20, y: card.t + 40, z: -0.3 },
      { t: T.EXIT[1], x: -W, y: -H, z: -1, e: ease.in },
    ],
    press: [T.GRAB_P1, T.GRAB_P2],
    clicks: [],
  };

  // C: abre a paleta e escolhe o fundo; joga fora o campo errado; desenha e pinta o botão
  const sw = pal.swatches;
  const c: Track = {
    keys: [
      { t: T.CURSORS_IN[0], x: W, y: 0, z: -1 },
      { t: T.CURSORS_IN[1], x: card.r + 50, y: cy(card), z: -0.3 },
      { t: T.PALETTE_OPEN - 200, x: pal.x - 26, y: pal.y + 12, z: 0.1 },
      { t: T.PALETTE_OPEN + 250, x: sw[0]!.x, y: sw[0]!.y, z: 0.2 },
      { t: T.PALETTE_OPEN + 450, x: sw[2]!.x, y: sw[2]!.y, z: 0.2 },
      { t: T.PALETTE_CLICK - 40, x: sw[4]!.x, y: sw[4]!.y, z: 0.25 },
      { t: T.PALETTE_CLOSE + 300, x: card.r - 40, y: card.b - 90, z: -0.3 },
      { t: T.CPF[0], x: cx(button) + 30, y: cy(button), z: 0.3 },
      { t: T.CPF[1], x: cx(button) + 60, y: H + 40, z: 0.5, e: ease.in },
      { t: T.BUTTON[0] - 60, x: button.l, y: button.t, z: 0.1 },
      { t: T.BUTTON[1], x: button.r, y: button.b, z: 0.1 },
      { t: T.PAINT, x: cx(button) + 20, y: cy(button), z: 0.15 },
      { t: T.EXIT[0], x: button.r + 40, y: button.b + 30, z: -0.2 },
      { t: T.EXIT[1], x: W, y: 0, z: -1, e: ease.in },
    ],
    press: [T.CPF, T.BUTTON, [T.PALETTE_CLICK - 30, T.PALETTE_CLICK + 90], [T.PAINT - 30, T.PAINT + 90]],
    clicks: [T.PALETTE_CLICK, T.PAINT],
  };

  // D: busca o logo errado, desenha os dois campos
  const d: Track = {
    keys: [
      { t: T.CURSORS_IN[0], x: -W, y: vh * 0.2, z: -1 },
      { t: T.CURSORS_IN[1], x: -vw * 0.3, y: vh * 0.22, z: -0.4 },
      { t: T.LOGO[0] - 300, x: ph.x - 20, y: ph.y + 20, z: 0.2 },
      { t: T.LOGO[0], x: ph.x, y: ph.y, z: 0.25 },
      { t: T.LOGO[1], x: cx(logo), y: cy(logo), z: 0.25, e: ease.inOut },
      { t: T.LOGO[1] + 500, x: card.l - 30, y: email.t - 20, z: -0.3 },
      { t: T.EMAIL[0], x: email.l, y: email.t, z: 0 },
      { t: T.EMAIL[1], x: email.r, y: email.b, z: 0.05 },
      { t: T.PASS[0], x: pass.l, y: pass.t, z: 0 },
      { t: T.PASS[1], x: pass.r, y: pass.b, z: 0.05 },
      { t: T.PASS[1] + 600, x: card.l - 60, y: cy(pass) + 40, z: -0.5 },
      { t: T.EXIT[0], x: card.l - 40, y: card.b, z: -0.3 },
      { t: T.EXIT[1], x: -W, y: vh * 0.2, z: -1, e: ease.in },
    ],
    press: [T.LOGO, T.EMAIL, T.PASS],
    clicks: [],
  };

  return { a, b, c, d };
}

/** A câmera durante a reconstrução: afasta para ver o empurrão, aproxima em cada conserto. */
export function rebuildCamera(L: Layout): CamKey[] {
  const { title, email, pass, button, logo, card } = L;
  const pal = palette(L);
  const near = L.vw < 600 ? 1.15 : 1.4;
  return [
    { t: T.BOX[0], s: 1, fx: 0, fy: 0 },
    { t: T.BOX[1], s: 0.94, fx: 0, fy: 0 },
    { t: T.GRAB_P2[1], s: 0.9, fx: 0, fy: 0 },
    { t: T.PALETTE_CLICK, s: 1.15, fx: (pal.x + PALETTE_W / 2) * 0.6, fy: pal.y * 0.6 },
    { t: T.LOGO[1] - 200, s: 1.12, fx: cx(logo) * 0.4, fy: (cy(logo) + card.t) * 0.35 },
    { t: T.ERASE[0] + 300, s: near, fx: cx(title), fy: cy(title) },
    { t: T.TYPE[1], s: near, fx: cx(title), fy: cy(title) },
    { t: T.EMAIL[0] + 300, s: 1.12, fx: cx(email) * 0.5, fy: ((cy(email) + cy(pass)) / 2) * 0.6 },
    { t: T.PASS[1], s: 1.12, fx: cx(email) * 0.5, fy: ((cy(email) + cy(pass)) / 2) * 0.6 },
    { t: T.BUTTON[0] + 200, s: 1.2, fx: cx(button) * 0.5, fy: cy(button) * 0.6 },
    { t: T.PAINT + 300, s: 1.2, fx: cx(button) * 0.5, fy: cy(button) * 0.6 },
    { t: T.EXIT[1] - 100, s: 1, fx: 0, fy: 0 },
  ];
}

/** Quanto da tela já foi reconstruído (0 a 100), pelos marcos. */
const PROGRESS: readonly (readonly [number, number])[] = [
  [T.BOX[0], 0],
  [T.BOX[1], 15],
  [T.GRAB_P2[1], 26],
  [T.PALETTE_CLICK + 300, 38],
  [T.LOGO[1], 49],
  [T.TYPE[1], 64],
  [T.PASS[1], 80],
  [T.CPF[1], 86],
  [T.PAINT + 300, 100],
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

export const TITLE_WRONG = 'Entarr na cnota';
export const TITLE = 'Entrar na conta';
