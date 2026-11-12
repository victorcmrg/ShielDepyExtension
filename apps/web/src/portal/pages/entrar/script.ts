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
  COLLAPSE: [15050, 15650] as const, // verificado, o cartão do meio se encolhe e some
  CAM_BACK: [12100, 12900] as const,
  A_POP: 12300, // o primeiro cursor entra voando pela direita da tela (não brota)
  A_ENTER: [12300, 13300] as const,
  LOOK: [13300, 14650] as const, // para, pisca rápido e olha em volta como gente (olhadas curtas, com pausas)
  VERIFY: [14650, 15200] as const, // vai ao cartão "Erro detectado" e começa a verificação
  VERIFY_CLICK: 14950,
  SPAWNER: [15500, 17000] as const, // A abre o contador "cursores 01 +": cada clique no "+" cria um
  SPAWN_B: 15900,
  SPAWN_C: 16350,
  SPAWN_D: 16800,
  CURSORS_IN: [15250, 16800] as const,
  SPAWNER2: [17100, 18350] as const, // A põe um segundo botão embaixo: "agentes do caos 00 +"
  SPAWN_X: 17450, // X analisa as ligações do grafo
  SPAWN_Y: 17900, // Y abre o DevTools e examina o 404 no console
  DEV_PULL: [18550, 19350] as const, // Y puxa o DevTools pela borda direita
  DEV_TAB: 19650, // clica em "Console"
  DEV_INSPECT: [19850, 21650] as const, // examina os erros, pensando (o DevTools fica aberto um bom tempo)
  DEV_FOUND: 20350, // marca o 404 como achado
  DEV_CLOSE: [21750, 22250] as const, // empurra o DevTools de volta
  GRAPH_OPEN: 18700, // X abre o mapa das ligações
  GRAPH_TRACE: [18950, 21050] as const, // percorre nó por nó
  GRAPH_FOUND: 20450, // a ligação /entrar → ∅ quebrada

  ANCHOR: [18400, 19800] as const, // C segura o canto enquanto A puxa
  BOX: [18550, 19750] as const, // A desenha a caixa do canto de cima à direita ao de baixo à esquerda
  SLOTS: [19650, 20250] as const, // as partes pontilhadas: onde cada peça vai ficar
  GRAB_P1: [19650, 20300] as const, // B pega cada balão pelo canto (pêndulo) e o lança para fora
  LOGO: [19850, 20850] as const, // D cria o logo grande e o encolhe puxando a alça do canto
  PALETTE_OPEN: 20150, // C abre a paleta e pensa bastante antes de escolher
  GRAB_P2: [20450, 21100] as const,
  ORBIT_B: [21150, 22450] as const, // B dá a volta e passa gigante na frente da câmera
  THINK_C1: [21100, 21750] as const,
  BUMP: 21150, // A e D se esbarram no meio do caminho
  SUB: [21300, 21950] as const, // A leva o subtítulo torto para o lugar
  PALETTE_CLICK: 21950,
  THINK_A: [22050, 22700] as const, // A olha o título errado antes de apagar
  EMAIL: [22150, 22750] as const, // D e C desenham os campos ao mesmo tempo
  PALETTE_CLOSE: 22300,
  PASS: [22450, 23050] as const,
  ERASE: [22750, 23650] as const, // A apaga o título errado...
  TYPE1: [22950, 24050] as const, // ...e B digita logo atrás, com um erro no fim
  CPF: [23250, 23700] as const, // C joga fora o campo que não devia estar ali
  BUTTON: [23450, 24050] as const, // D desenha o botão
  THINK_B: [24100, 24650] as const, // B percebe o erro
  THINK_C2: [24150, 24750] as const, // C pensa na cor do botão
  BACK: [24250, 25150] as const, // D traz o link de volta lá de cima
  BACKSPACE: [24650, 24950] as const,
  PAINT: 24850,
  TYPE2: [25000, 25350] as const,
  FOCUS_EMAIL: 25150, // C confere o foco de cada campo
  FOCUS_PASS: 25400,
  FONT_OPEN: 25450, // A abre as fontes, pensa e escolhe a do título
  ORBIT_D: [25450, 26850] as const, // D dá a volta gigante
  THINK_A2: [25500, 26150] as const,
  FONT_PICK: 26250,
  FONT_CLOSE: 26500,
  GRAPH_FIXED: 25450, // depois da correção, a ligação fica verde
  DEV_FINAL: [25650, 27350] as const, // Y reabre o DevTools: agora 200 e 0 erros
  DEV_OK: 26100,
  GRAPH_CLOSE: 26650,
  HIGH5: 27450, // os quatro se encontram em cima do cartão
  EXIT: [27650, 28350] as const,
  END: 28550,
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
  /** x e y são da tela (relativos ao centro), não do mundo: o motor converte com a câmera do instante */
  screen?: boolean;
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
      let u = (t - a.t) / dt;
      // chegando onde vai parar: o freio é mais longo; saindo de uma parada: arranca devagar
      if (b.hold && !a.hold) u = lerp(u, 1 - (1 - u) * (1 - u), 0.55);
      else if (a.hold && !b.hold) u = lerp(u, u * u, 0.3);
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

/** Teletransporte (os agentes do caos): em cada trecho longo o cursor fica parado e, aos 72% do tempo,
 *  aparece no ponto seguinte; trechos curtos (pensar, rondar) seguem a curva normal. */
export const TELEPORT_MIN = 50;
export function teleportSample(keys: readonly Key[], t: number): { x: number; y: number; z: number } {
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      if (t <= a.t || Math.hypot(b.x - a.x, b.y - a.y) < TELEPORT_MIN) return sample(keys, t);
      const u = (t - a.t) / (b.t - a.t || 1);
      return u < 0.72 ? { x: a.x, y: a.y, z: a.z } : { x: b.x, y: b.y, z: b.z };
    }
  }
  return sample(keys, t);
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

/** A divisão em líquido: quanto do caminho (0 = no cartão do meio, 1 = no lugar) o cartão novo andou.
 *  Sai rápido de trás, estica devagar (resistência), segura um instante perto do ponto de ruptura,
 *  rompe e recua com mola até o lugar. */
export const SPLIT_SNAP = 0.74;
export function splitPull(u: number): number {
  if (u <= 0.15) return 0.55 * ease.out(clamp01(u / 0.15));
  if (u <= 0.62) return lerp(0.55, 1.18, ease.out((u - 0.15) / 0.47));
  if (u <= SPLIT_SNAP) return lerp(1.18, 1.22, (u - 0.62) / (SPLIT_SNAP - 0.62));
  const k = clamp01((u - SPLIT_SNAP) / (1 - SPLIT_SNAP));
  return lerp(1.22, 1, 1 - Math.exp(-6 * k) * Math.cos(9 * k));
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type P2 = { x: number; y: number };
const f1 = (n: number) => n.toFixed(1);
const vecAt = (c: P2, a: number, r: number): P2 => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

/** A ponte entre dois círculos (o "metaball" clássico): duas curvas tangentes que afinam quando os
 *  centros se afastam. `v` é a abertura: menor, mais fina. */
function metaball(r1: number, r2: number, c1: P2, c2: P2, v: number): string {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (r1 <= 0 || r2 <= 0 || d <= Math.abs(r1 - r2) + 1) return '';
  let u1 = 0;
  let u2 = 0;
  if (d < r1 + r2) {
    u1 = Math.acos(clamp01((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)));
    u2 = Math.acos(clamp01((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)));
  }
  const ab = Math.atan2(c2.y - c1.y, c2.x - c1.x);
  const spread = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const a1 = ab + u1 + (spread - u1) * v;
  const a2 = ab - u1 - (spread - u1) * v;
  const a3 = ab + Math.PI - u2 - (Math.PI - u2 - spread) * v;
  const a4 = ab - Math.PI + u2 + (Math.PI - u2 - spread) * v;
  const p1 = vecAt(c1, a1, r1);
  const p2 = vecAt(c1, a2, r1);
  const p3 = vecAt(c2, a3, r2);
  const p4 = vecAt(c2, a4, r2);
  const total = r1 + r2;
  const d2 = Math.min(v * 2.4, Math.hypot(p3.x - p1.x, p3.y - p1.y) / total) * Math.min(1, (d * 2) / total);
  const h1 = vecAt(p1, a1 - Math.PI / 2, r1 * d2);
  const h2 = vecAt(p2, a2 + Math.PI / 2, r1 * d2);
  const h3 = vecAt(p3, a3 + Math.PI / 2, r2 * d2);
  const h4 = vecAt(p4, a4 - Math.PI / 2, r2 * d2);
  const big = d > total ? 1 : 0;
  return (
    `M ${f1(p1.x)} ${f1(p1.y)} C ${f1(h1.x)} ${f1(h1.y)} ${f1(h3.x)} ${f1(h3.y)} ${f1(p3.x)} ${f1(p3.y)} ` +
    `A ${f1(r2)} ${f1(r2)} 0 ${big} 0 ${f1(p4.x)} ${f1(p4.y)} C ${f1(h4.x)} ${f1(h4.y)} ${f1(h2.x)} ${f1(h2.y)} ${f1(p2.x)} ${f1(p2.y)} Z`
  );
}

const circle = (c: P2, r: number) =>
  r <= 0.5 ? '' : `M ${f1(c.x - r)} ${f1(c.y)} a ${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0 a ${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0 Z`;

/** A ligação líquida entre o cartão do meio (a) e o que sai dele (b) no instante u da divisão: a ponte
 *  estica e afina até romper em SPLIT_SNAP; depois, dois respingos voltam para dentro de cada cartão. */
export function liquidNeck(a: Box, b: Box, u: number): string {
  if (u < 0.1) return '';
  const r = Math.min(a.h, b.h) * 0.34;
  const inside = (box: Box, p: P2): P2 => ({
    x: Math.max(box.x - box.w / 2 + r, Math.min(box.x + box.w / 2 - r, p.x)),
    y: Math.max(box.y - box.h / 2 + r, Math.min(box.y + box.h / 2 - r, p.y)),
  });
  const c1 = inside(a, b);
  const c2 = inside(b, a);
  if (u >= SPLIT_SNAP) {
    const k = clamp01((u - SPLIT_SNAP) / 0.14);
    if (k >= 1) return '';
    const d = Math.hypot(c2.x - c1.x, c2.y - c1.y) || 1;
    const ux = (c2.x - c1.x) / d;
    const uy = (c2.y - c1.y) / d;
    const reach = r * (1.05 - 0.6 * ease.out(k));
    const rr = r * 0.42 * (1 - ease.in(k));
    return circle({ x: c1.x + ux * reach, y: c1.y + uy * reach }, rr) + circle({ x: c2.x - ux * reach, y: c2.y - uy * reach }, rr);
  }
  // quanto mais perto da ruptura, mais fina a ponte
  const tension = clamp01((u - 0.1) / (SPLIT_SNAP - 0.1));
  return metaball(r, r * (1 - 0.25 * tension), c1, c2, lerp(0.62, 0.18, tension));
}

/** Onde ficam os balões, a partir do tamanho da tela. */
export function balloonSpots(vw: number, vh: number) {
  const dx = Math.min(260, Math.max(60, vw * 0.22));
  const dy = Math.min(195, Math.max(150, vh * 0.24));
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
export function orbit(o: { t0: number; t1: number; x: number; y: number; rx: number; ry: number; zMid: number; zAmp: number; from: number; dir: 1 | -1; linger?: number }): Key[] {
  // ângulos iguais, tempos diferentes: perto da frente (sen = 1) cada passo demora mais, então o
  // cursor desacelera de leve bem na frente da câmera, fica ali um instante e segue
  const n = 16;
  const th = (i: number) => o.from + o.dir * ((Math.PI * 2 * i) / n);
  const front = (a: number) => {
    const d = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2));
    return Math.exp(-(d * d) / (2 * 0.55 * 0.55));
  };
  const w = Array.from({ length: n }, (_, i) => 1 / (1 - (o.linger ?? 0.72) * front((th(i) + th(i + 1)) / 2)));
  const total = w.reduce((a, b) => a + b, 0);
  const keys: Key[] = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const a = th(i);
    keys.push({ t: o.t0 + ((o.t1 - o.t0) * acc) / total, x: o.x + o.rx * Math.cos(a), y: o.y + o.ry * Math.sin(a), z: o.zMid + o.zAmp * Math.sin(a) });
    acc += w[i] ?? 0;
  }
  return keys;
}

/** O instante em que a órbita passa mais perto da câmera (para piscar ali). */
export function orbitPeak(keys: readonly Key[]): number {
  let best = keys[0]!;
  for (const key of keys) if (key.z > best.z) best = key;
  return best.t;
}

/** Onde fica o "+" que o primeiro cursor abre para criar os outros. */
export const SPAWNER_W = 150;
export function spawner(L: Layout) {
  const x = Math.min(L.card.r + 64, L.vw / 2 - SPAWNER_W / 2 - 10);
  const y = cy(L.card) - 60;
  return { x, y, plus: { x: x + SPAWNER_W / 2 - 22, y } };
}
/** Para onde cada cursor novo vai logo que sai do "+" (um leque acima da pílula). */
export function spawnFan(L: Layout, i: 0 | 1 | 2) {
  const sp = spawner(L);
  return [
    { x: sp.x - 50, y: sp.y - 78 },
    { x: sp.x + 4, y: sp.y - 96 },
    { x: sp.x + 58, y: sp.y - 78 },
  ][i]!;
}

/** Os esbarrões só valem nos encontros combinados (fora deles, um cursor não empurra o outro). */
export const BUMP_WINDOWS: readonly Interval[] = [
  [T.BUMP - 350, T.BUMP + 350],
  [T.HIGH5 - 500, T.HIGH5 + 300],
];

/** O logo nasce grande (LOGO_BIG vezes) e D o encolhe puxando a alça do canto. */
export const LOGO_BIG = 2.4;

/** Olho de peixe invertido: perto da borda da tela, as coisas crescem e são puxadas para fora. */
export const LENS_START = 0.6;
export function lens(sx: number, sy: number, vw: number, vh: number): { dx: number; dy: number; k: number } {
  const nx = sx / (vw / 2);
  const ny = sy / (vh / 2);
  const e = Math.max(Math.abs(nx), Math.abs(ny));
  if (e <= LENS_START) return { dx: 0, dy: 0, k: 1 };
  const f = Math.min(1.4, (e - LENS_START) / (1 - LENS_START));
  const f2 = f * f;
  const r = Math.hypot(nx, ny) || 1;
  return { dx: (nx / r) * f2 * 34, dy: (ny / r) * f2 * 34, k: 1 + f2 * 0.28 };
}

export type CursorId = 'a' | 'b' | 'c' | 'd' | 'x' | 'y';
/** Os agentes do caos (vermelhos): acham os problemas; os outros consertam. */
export const CHAOS: readonly CursorId[] = ['x', 'y'];

/** O segundo contador, logo abaixo do primeiro: "agentes do caos 00 +". */
export function spawner2(L: Layout) {
  const sp = spawner(L);
  return { x: sp.x, y: sp.y + 52, plus: { x: sp.plus.x, y: sp.y + 52 } };
}

/** O mapa das ligações que X abre: as rotas e o componente, com a ligação quebrada /entrar → <Login/>. */
export function graphPanel(L: Layout) {
  const free = L.vw / 2 - (L.card.r - L.card.l) / 2 - 40;
  const w = Math.max(230, Math.min(330, free));
  const h = 196;
  const x = -L.vw / 2 + 20;
  const y = -L.vh / 2 + 78;
  const at = (fx: number, fy: number) => ({ x: x + w * fx, y: y + h * fy });
  const nodes = [
    { id: 'root', label: '/', ...at(0.15, 0.36) },
    { id: 'entrar', label: '/entrar', ...at(0.5, 0.36) },
    { id: 'login-c', label: '<Login/>', ...at(0.85, 0.36) },
    { id: 'login', label: '/login', ...at(0.5, 0.78) },
    { id: 'auth', label: '/api/auth', ...at(0.85, 0.78) },
  ];
  const edges = [
    { from: 0, to: 1, broken: false },
    { from: 1, to: 2, broken: true },
    { from: 3, to: 2, broken: false },
    { from: 2, to: 4, broken: false },
  ];
  return { x, y, w, h, nodes, edges };
}

/** O DevTools que Y puxa da borda direita (na tela, preso ao canto: a câmera não o move): largura, onde
 *  fica fechado e aberto, a aba Console e as linhas. */
export const DEV_LINE_H = 24;
export function devtools(L: Layout) {
  const w = Math.min(340, L.vw * 0.36);
  const closed = L.vw / 2;
  const top = -L.vh / 2;
  const open = closed - w;
  return {
    w,
    closed,
    open,
    top,
    h: L.vh,
    handleY: -L.vh * 0.08,
    tab: { dx: 104, y: top + 17 },
    line: (i: number) => top + 70 + i * DEV_LINE_H + DEV_LINE_H / 2,
  };
}
export interface Track {
  keys: Key[];
  /** intervalos com o botão apertado (arrastando ou segurando) */
  press: Interval[];
  /** cliques (marca na tela) */
  clicks: number[];
  /** momentos em que o cursor para e pensa (balão de "…", olhos procurando) */
  think: Interval[];
  /** quando o cursor aparece (num estalo) e quando some (outro estalo) */
  born: number;
  gone: number;
  /** toques rápidos (cada tecla digitada), só para o cursor afundar um instante */
  taps: number[];
  /** piscadas (os olhos fecham e abrem), como quando D passa bem perto da câmera */
  blinks?: number[];
  /** entra voando de fora da tela em vez de nascer num estalo */
  enter?: boolean;
  /** olhadas: os olhos pulam para (x, y) no instante t e ficam lá até a próxima (unidades do desenho) */
  looks?: { t: number; x: number; y: number }[];
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

/** Cada tecla (as letras, os três apagares e as três letras da correção): o cursor afunda um instante. */
export function typingTaps(): number[] {
  const back = [1, 2, 3].map((i) => T.BACKSPACE[0] + ((T.BACKSPACE[1] - T.BACKSPACE[0]) * (i - 0.5)) / 3);
  const fix = [1, 2, 3].map((i) => T.TYPE2[0] + ((T.TYPE2[1] - T.TYPE2[0]) * (i - 0.5)) / 3);
  return [...TYPE_TIMES, ...back, ...fix];
}

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

/** A alça do canto de baixo à direita do logo quando ele nasce grande. */
export function logoHandle(L: Layout): Pt2 {
  const hw = ((L.logo.r - L.logo.l) / 2) * LOGO_BIG;
  const hh = ((L.logo.b - L.logo.t) / 2) * LOGO_BIG;
  return { x: cx(L.logo) + hw, y: cy(L.logo) + hh };
}
type Pt2 = { x: number; y: number };

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
  const sp = spawner(L);
  const tw = title.r - title.l;
  // a saída: depois do encontro, cada um some num estalo, um depois do outro
  const goneAt = (i: number) => T.EXIT[0] + i * 170 + 280;
  const caretX = (n: number) => title.l + (tw * n) / TITLE.length;

  // A: puxa a caixa, esbarra em D, endireita o subtítulo, pensa e apaga o título, escolhe a fonte
  const zig: Key[] = [];
  const passes = 7;
  for (let i = 1; i <= passes; i++) {
    const p = i / passes;
    zig.push(k(T.ERASE[0] + (T.ERASE[1] - T.ERASE[0]) * p, lerp(title.l, title.r, p) + (i % 2 ? 16 : -16), cy(title) + (i % 2 ? -7 : 7), 0.2, i === passes));
  }
  const f = fonts.opts;
  const spawnTaps = [T.SPAWN_B, T.SPAWN_C, T.SPAWN_D];
  const sp2 = spawner2(L);
  const chaosTaps = [T.SPAWN_X, T.SPAWN_Y];
  const a: Track = {
    keys: [
      // entra pela direita, perto da câmera, e desacelera ao lado do cartão do meio
      k(T.A_POP, vw / 2 + 40, spots.p0.y - 70, 0.6),
      k(lerp(T.A_ENTER[0], T.A_ENTER[1], 0.55), spots.p0.x + 260, spots.p0.y - 20, 0.35),
      k(T.A_ENTER[1], spots.p0.x + 200, spots.p0.y + 18, 0.2, true),
      // olhando em volta: a cabeça quase parada
      k(lerp(T.LOOK[0], T.LOOK[1], 0.4), spots.p0.x + 203, spots.p0.y + 15, 0.21),
      k(T.LOOK[1], spots.p0.x + 198, spots.p0.y + 19, 0.2, true),
      // a verificação: vai até o cartão e clica
      k(T.VERIFY_CLICK, spots.p0.x + 70, spots.p0.y + 14, 0.05, true),
      k(T.VERIFY[1], spots.p0.x + 96, spots.p0.y + 40, 0.1, true),
      k(T.SPAWNER[0], sp.x - 20, sp.y + 24, 0.05, true),
      ...spawnTaps.flatMap((st) => [k(st - 160, sp.plus.x + 2, sp.plus.y + 2, 0, true), k(st + 160, sp.plus.x + 8, sp.plus.y + 14, 0.02, true)]),
      k(T.SPAWNER2[0] - 120, sp.x - 30, sp2.y + 10, 0.05),
      k(T.SPAWNER2[0], sp.x - 20, sp2.y + 6, 0, true),
      ...chaosTaps.flatMap((st) => [k(st - 160, sp2.plus.x + 2, sp2.plus.y + 2, 0, true), k(st + 160, sp2.plus.x + 8, sp2.plus.y + 14, 0.02, true)]),
      k(T.SPAWNER2[1], sp.x - 40, sp2.y + 40, 0),
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
      k(goneAt(3), meet.high5.x - 34, meet.high5.y - 6, 0.15, true),
    ],
    press: [[T.VERIFY_CLICK - 30, T.VERIFY_CLICK + 90], T.BOX, T.SUB, T.ERASE, [T.FONT_OPEN - 30, T.FONT_OPEN + 80], [T.FONT_PICK - 30, T.FONT_PICK + 90], ...[...spawnTaps, ...chaosTaps].map((st): Interval => [st - 40, st + 70]), [T.SPAWNER[0] - 90, T.SPAWNER[0] + 10], [T.SPAWNER2[0] - 90, T.SPAWNER2[0] + 10]],
    clicks: [T.VERIFY_CLICK, T.FONT_OPEN, T.FONT_PICK, ...spawnTaps, ...chaosTaps, T.SPAWNER[0] - 60, T.SPAWNER2[0] - 60],
    think: [T.THINK_A, T.THINK_A2],
    born: T.A_POP,
    gone: goneAt(3),
    taps: [],
    enter: true,
    blinks: [T.LOOK[0] + 60, T.LOOK[0] + 230, T.LOOK[1] - 160],
    // olhadas rápidas, com paradas longas (~300 a 400 ms) antes de olhar para outro lugar
    looks: [
      { t: T.LOOK[0] + 300, x: -5, y: -2 },
      { t: T.LOOK[0] + 700, x: 4.5, y: -3 },
      { t: T.LOOK[0] + 1050, x: -2, y: 2.5 },
      { t: T.LOOK[1] + 60, x: 3.5, y: 1 },
      { t: T.LOOK[1] + 380, x: -4, y: 0 },
    ],
  };

  // B: puxa os balões para fora vindo para perto da câmera, dá a volta gigante, digita, erra e corrige
  const below = cy(title) + 30;
  const typeKeys: Key[] = [0.25, 0.5, 0.75].map((p) => k(lerp(T.TYPE1[0], T.TYPE1[1], p), caretX(TITLE.length * p) - 18, below + (p === 0.5 ? 2 : 0), 0.05));
  const b: Track = {
    keys: [
      k(T.SPAWN_B, sp.plus.x, sp.plus.y, 0, true),
      k(T.SPAWN_B + 380, spawnFan(L, 0).x, spawnFan(L, 0).y, 0.15, true),
      k(T.SPAWN_B + 1300, spots.p1.x + 90, spots.p1.y - 80, 0.4),
      k(T.GRAB_P1[0] - 350, spots.p1.x - 70, spots.p1.y - 60, 0.9),
      { ...k(T.GRAB_P1[0], spots.p1.x, spots.p1.y, 1.1, true), tag: 'p1' },
      k(lerp(T.GRAB_P1[0], T.GRAB_P1[1], 0.42), spots.p1.x - 60, spots.p1.y + 36, 1.05),
      k(T.GRAB_P1[1], W - 40, -H + 30, 1.1),
      { ...k(T.GRAB_P2[0], spots.p2.x, spots.p2.y, 0.9, true), tag: 'p2' },
      k(lerp(T.GRAB_P2[0], T.GRAB_P2[1], 0.42), spots.p2.x + 70, spots.p2.y - 30, 0.85),
      k(T.GRAB_P2[1], -W + 40, spots.p2.y + 60, 0.9),
      ...orbit({ t0: T.ORBIT_B[0], t1: T.ORBIT_B[1] - 200, x: 0, y: cy(card) + 40, rx: Math.min(vw * 0.36, 430), ry: 90, zMid: 0.8, zAmp: 2.8, from: Math.PI, dir: 1 }),
      k(T.TYPE1[0] - 400, title.l - 50, below + 40, -0.2),
      k(T.TYPE1[0], caretX(0) - 18, below, 0.05, true),
      ...typeKeys,
      k(T.TYPE1[1], caretX(TITLE.length) - 18, below, 0.05, true),
      ...ponder(T.THINK_B[0], T.THINK_B[1], caretX(TITLE.length) + 6, below + 8, 0.1, 9),
      k(T.BACKSPACE[1], caretX(FIX_FROM) - 18, below, 0.05, true),
      k(T.TYPE2[1], caretX(TITLE.length) - 18, below, 0.05, true),
      k(T.TYPE2[1] + 600, card.l - 60, cy(card) - 40, -0.3),
      k(T.HIGH5 - 600, card.l + 20, card.t - 40, -0.2),
      k(T.HIGH5, meet.high5.x - 2, meet.high5.y - 22, 0.1),
      k(goneAt(2), meet.high5.x - 6, meet.high5.y - 40, 0.15, true),
    ],
    press: [T.GRAB_P1, T.GRAB_P2],
    clicks: [],
    think: [T.THINK_B],
    born: T.SPAWN_B,
    gone: goneAt(2),
    taps: typingTaps(),
  };

  // C: segura o canto, pensa muito antes de escolher a cor, desenha a senha, joga fora o CPF,
  // pensa na cor do botão e o pinta, confere o foco dos campos
  const c: Track = {
    keys: [
      k(T.SPAWN_C, sp.plus.x, sp.plus.y, 0, true),
      k(T.SPAWN_C + 380, spawnFan(L, 1).x, spawnFan(L, 1).y, 0.15, true),
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
      k(goneAt(1), meet.high5.x + 34, meet.high5.y - 4, 0.15, true),
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
    born: T.SPAWN_C,
    gone: goneAt(1),
    taps: [],
  };

  // D: carrega o logo (levantando perto da câmera), esbarra em A, desenha o e-mail e o botão,
  // traz o link de volta lá de cima e dá a volta gigante
  const big = logoHandle(L);
  const orbitD = orbit({ t0: T.ORBIT_D[0], t1: T.ORBIT_D[1], x: 0, y: cy(card) - 20, rx: Math.min(vw * 0.38, 450), ry: 110, zMid: 0.9, zAmp: 3.1, from: 0, dir: -1, linger: 0.82 });
  const peakD = orbitPeak(orbitD);
  const d: Track = {
    keys: [
      k(T.SPAWN_D, sp.plus.x, sp.plus.y, 0, true),
      k(T.SPAWN_D + 380, spawnFan(L, 2).x, spawnFan(L, 2).y, 0.15, true),
      k(T.LOGO[0] - 400, cx(logo) - 60, cy(logo) + 50, 0.1),
      k(T.LOGO[0], cx(logo), cy(logo), 0.1, true),
      k(T.LOGO[0] + 350, big.x, big.y, 0.15, true),
      k(T.LOGO[1], logo.r, logo.b, 0.1, true),
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
      ...orbitD,
      k(T.HIGH5 - 300, meet.high5.x + 40, meet.high5.y - 60, 0),
      k(T.HIGH5, meet.high5.x + 2, meet.high5.y + 26, 0.1),
      k(goneAt(0), meet.high5.x + 4, meet.high5.y + 46, 0.15, true),
    ],
    press: [[T.LOGO[0] - 30, T.LOGO[0] + 80], [T.LOGO[0] + 350, T.LOGO[1]], T.EMAIL, T.BUTTON, T.BACK],
    clicks: [T.LOGO[0]],
    think: [],
    born: T.SPAWN_D,
    gone: goneAt(0),
    taps: [],
    blinks: [peakD - 170, peakD + 150],
  };

  // X: abre o mapa das ligações, percorre os nós, para na ligação quebrada, depois confere a correção
  const g = graphPanel(L);
  const n = g.nodes;
  const mid = { x: (n[1]!.x + n[2]!.x) / 2, y: (n[1]!.y + n[2]!.y) / 2 };
  const x: Track = {
    keys: [
      k(T.SPAWN_X, sp2.plus.x, sp2.plus.y, 0, true),
      k(T.SPAWN_X + 380, sp2.x - 40, sp2.y + 70, 0.15, true),
      k(T.GRAPH_OPEN - 300, g.x + g.w + 20, g.y + 30, 0.1),
      k(T.GRAPH_OPEN, g.x + g.w - 16, g.y + 12, 0.05, true),
      k(T.GRAPH_TRACE[0], n[0]!.x, n[0]!.y, 0.05, true),
      k(lerp(T.GRAPH_TRACE[0], T.GRAPH_FOUND, 0.45), n[1]!.x, n[1]!.y, 0.05, true),
      ...ponder(T.GRAPH_FOUND - 900, T.GRAPH_FOUND, mid.x, mid.y + 4, 0.1, 8),
      k(T.GRAPH_FOUND + 300, mid.x, mid.y, 0.05, true),
      k(lerp(T.GRAPH_FOUND, T.GRAPH_TRACE[1], 0.5), n[3]!.x, n[3]!.y, 0.05, true),
      k(T.GRAPH_TRACE[1], n[4]!.x, n[4]!.y, 0.05, true),
      ...ponder(T.GRAPH_TRACE[1] + 400, T.GRAPH_FIXED - 1000, g.x + g.w * 0.3, g.y + g.h + 40, 0, 16),
      ...ponder(T.GRAPH_FIXED - 800, T.GRAPH_FIXED - 40, mid.x + 6, mid.y + 10, 0.1, 8),
      k(T.GRAPH_FIXED, mid.x, mid.y, 0.05, true),
      k(T.GRAPH_CLOSE, g.x + g.w - 16, g.y + 12, 0.05, true),
      k(T.GRAPH_CLOSE + 400, g.x + g.w * 0.5, g.y + g.h * 0.5, 0.1, true),
    ],
    press: [[T.GRAPH_OPEN - 30, T.GRAPH_OPEN + 80], [T.GRAPH_FOUND + 270, T.GRAPH_FOUND + 380], [T.GRAPH_FIXED - 30, T.GRAPH_FIXED + 80], [T.GRAPH_CLOSE - 30, T.GRAPH_CLOSE + 80]],
    clicks: [T.GRAPH_OPEN, T.GRAPH_FOUND + 300, T.GRAPH_FIXED, T.GRAPH_CLOSE],
    think: [
      [T.GRAPH_FOUND - 900, T.GRAPH_FOUND],
      [T.GRAPH_FIXED - 800, T.GRAPH_FIXED - 40],
    ],
    born: T.SPAWN_X,
    gone: T.GRAPH_CLOSE + 650,
    taps: [],
  };

  // Y: puxa o DevTools pela borda, clica em Console, examina os erros e marca o 404; no fim confere o 200
  const dv = devtools(L);
  const scr = (key: Key): Key => ({ ...key, screen: true });
  const y: Track = {
    keys: [
      k(T.SPAWN_Y, sp2.plus.x, sp2.plus.y, 0, true),
      k(T.SPAWN_Y + 380, sp2.x + 50, sp2.y + 70, 0.15, true),
      scr(k(T.DEV_PULL[0] - 200, dv.closed - 30, dv.handleY + 20, 0.05)),
      scr(k(T.DEV_PULL[0], dv.closed - 5, dv.handleY, 0, true)),
      scr(k(T.DEV_PULL[1], dv.open + 5, dv.handleY, 0, true)),
      scr(k(T.DEV_TAB, dv.open + dv.tab.dx, dv.tab.y, 0.05, true)),
      scr(k(T.DEV_INSPECT[0], dv.open + dv.w * 0.55, dv.line(0), 0.05, true)),
      ...ponder(T.DEV_INSPECT[0] + 50, T.DEV_FOUND - 30, dv.open + dv.w * 0.6, dv.line(1), 0.08, 8).map(scr),
      scr(k(T.DEV_FOUND, dv.open + dv.w * 0.5, dv.line(0), 0.05, true)),
      scr(k(T.DEV_INSPECT[1], dv.open + dv.w * 0.45, dv.line(2), 0.05, true)),
      scr(k(T.DEV_CLOSE[0], dv.open + 5, dv.handleY, 0, true)),
      scr(k(T.DEV_CLOSE[1], dv.closed - 5, dv.handleY, 0, true)),
      ...ponder(T.DEV_CLOSE[1] + 400, T.DEV_FINAL[0] - 300, dv.closed - 90, dv.handleY + 120, -0.2, 18).map(scr),
      scr(k(T.DEV_FINAL[0], dv.closed - 5, dv.handleY, 0, true)),
      scr(k(T.DEV_FINAL[0] + 400, dv.open + 5, dv.handleY, 0, true)),
      scr(k(T.DEV_OK, dv.open + dv.w * 0.5, dv.line(4), 0.05, true)),
      scr(k(T.DEV_FINAL[1] - 400, dv.open + 5, dv.handleY, 0, true)),
      scr(k(T.DEV_FINAL[1], dv.closed - 5, dv.handleY, 0, true)),
      scr(k(T.DEV_FINAL[1] + 300, dv.closed - 60, dv.handleY + 40, 0.1, true)),
    ],
    press: [T.DEV_PULL, [T.DEV_TAB - 30, T.DEV_TAB + 80], [T.DEV_FOUND - 30, T.DEV_FOUND + 80], T.DEV_CLOSE, [T.DEV_FINAL[0], T.DEV_FINAL[0] + 400], [T.DEV_FINAL[1] - 400, T.DEV_FINAL[1]]],
    clicks: [T.DEV_TAB, T.DEV_FOUND],
    think: [[T.DEV_INSPECT[0] + 50, T.DEV_FOUND - 30]],
    born: T.SPAWN_Y,
    gone: T.DEV_FINAL[1] + 600,
    taps: [],
  };

  return { a, b, c, d, x, y };
}

/** A câmera durante a reconstrução: abre e inclina em 3D quando há muito acontecendo, aproxima nos consertos. */
export function rebuildCamera(L: Layout): CamKey[] {
  // pouca câmera: zoom entre 0,96 e 1,1, foco no máximo um quarto do caminho até o detalhe e
  // inclinação pequena, para a tela de login ficar no meio
  const { title, button, card } = L;
  const sp = spawner(L);
  const birth = L.vw < 600 ? 1.12 : 1.25;
  const q = 0.25;
  return [
    { t: T.CAM_BACK[1], s: 1.08, fx: 120, fy: -20, rx: 0, ry: 0 },
    { t: T.A_ENTER[1], s: 1.3, fx: 175, fy: 10, rx: 0, ry: 2 },
    { t: T.LOOK[1], s: 1.34, fx: 170, fy: 10, rx: -1, ry: 1 },
    { t: T.VERIFY_CLICK, s: 1.22, fx: 60, fy: 0, rx: 0, ry: 0 },
    { t: T.SPAWNER[0], s: birth, fx: sp.x * 0.7, fy: (sp.y - 30) * 0.7, rx: -2, ry: 3 },
    { t: T.SPAWN_D + 400, s: birth, fx: sp.x * 0.7, fy: (sp.y - 40) * 0.7, rx: -2, ry: -2 },
    { t: T.SPAWN_Y + 350, s: birth, fx: sp.x * 0.7, fy: (sp.y + 10) * 0.7, rx: 1, ry: -2 },
    { t: T.BOX[0], s: 1, fx: 0, fy: 0, hold: true },
    { t: T.BOX[1], s: 0.98, fx: 0, fy: 0, rx: 3, ry: -3.5 },
    { t: T.GRAB_P2[1], s: 0.96, fx: 0, fy: 0, rx: 2, ry: 3.5 },
    { t: T.ERASE[0], s: 1.08, fx: cx(title) * q, fy: cy(title) * q, rx: 1, ry: -2 },
    { t: T.THINK_B[0], s: 1.1, fx: cx(title) * q, fy: cy(title) * q, rx: 0, ry: 1.5 },
    { t: T.PAINT, s: 1.02, fx: cx(button) * q, fy: cy(button) * q, rx: 2.5, ry: -2 },
    { t: T.TYPE2[1], s: 1.08, fx: cx(title) * q, fy: cy(title) * q, rx: 0, ry: 0 },
    { t: T.ORBIT_D[1], s: 0.98, fx: 0, fy: 0, rx: 2.5, ry: -1.5 },
    { t: T.HIGH5, s: 1.05, fx: cx(card) * q, fy: (card.t + 34) * q, rx: -1.5, ry: 0 },
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
