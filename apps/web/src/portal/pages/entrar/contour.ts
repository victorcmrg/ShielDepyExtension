// O contorno de uma letra desenhada num canvas (decisão 0040): a grade de pixels "dentro / fora" vira
// polígonos (o de fora e os furos, como o miolo do "0"), suavizados, para o three.js extrudar em 3D.
// Puro, sem DOM: quem desenha a letra e lê os pixels é letters3d.ts.

export type Pt = readonly [number, number];
export type Poly = Pt[];
export interface Outline {
  outer: Poly;
  holes: Poly[];
}

/**
 * Os contornos pelas arestas dos pixels. Cada aresta entre um pixel de dentro e um de fora entra
 * orientada (sempre com o "dentro" do mesmo lado), e as arestas se emendam em laços fechados.
 */
export function traceLoops(inside: (x: number, y: number) => boolean, w: number, h: number): Poly[] {
  const W = w + 1;
  const out = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const key = x0 + y0 * W;
    const end = x1 + y1 * W;
    const list = out.get(key);
    if (list) list.push(end);
    else out.set(key, [end]);
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && inside(x, y);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x + 1, y, x, y); // em cima, para a esquerda
      if (!at(x - 1, y)) add(x, y, x, y + 1); // à esquerda, para baixo
      if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1); // embaixo, para a direita
      if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y); // à direita, para cima
    }
  }
  const loops: Poly[] = [];
  for (const [start, ends] of out) {
    while (ends.length) {
      const loop: Pt[] = [];
      let from = start;
      let dir: Pt = [0, 0];
      let guard = 0;
      for (;;) {
        const list = out.get(from);
        if (!list || !list.length) break;
        // no cruzamento (dois pixels encostados só pela quina), vira sempre para o mesmo lado
        let pick = 0;
        if (list.length > 1) {
          const fx = from % W;
          const fy = Math.floor(from / W);
          const want: Pt = [dir[1], -dir[0]];
          const i = list.findIndex((e) => (e % W) - fx === want[0] && Math.floor(e / W) - fy === want[1]);
          pick = i >= 0 ? i : 0;
        }
        const next = list.splice(pick, 1)[0]!;
        const fx = from % W;
        const fy = Math.floor(from / W);
        loop.push([fx, fy]);
        dir = [(next % W) - fx, Math.floor(next / W) - fy];
        from = next;
        if (from === start || ++guard > 1e6) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Área com sinal (pela fórmula do laço): o sinal separa o contorno de fora dos furos. */
export function area(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function inPoly(pt: Pt, p: Poly): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Tira os pontos no meio de uma reta (a escada de pixels vira trechos maiores). */
function dropCollinear(p: Poly): Poly {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length]!;
    const b = p[i]!;
    const c = p[(i + 1) % p.length]!;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

/** Ramer-Douglas-Peucker num laço fechado: menos pontos, mesma forma (até eps de distância). */
function simplify(p: Poly, eps: number): Poly {
  if (p.length < 6) return p;
  const rdp = (pts: Pt[]): Pt[] => {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    let best = -1;
    let bestD = 0;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < pts.length - 1; i++) {
      const q = pts[i]!;
      const d = Math.abs(dy * q[0] - dx * q[1] + b[0] * a[1] - b[1] * a[0]) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD <= eps || best < 0) return [a, b];
    const left = rdp(pts.slice(0, best + 1));
    const right = rdp(pts.slice(best));
    return [...left.slice(0, -1), ...right];
  };
  const half = Math.floor(p.length / 2);
  const first = rdp([...p.slice(0, half + 1)]);
  const second = rdp([...p.slice(half), p[0]!]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Chaikin: arredonda as quinas (a escada de pixels vira curva). */
function smooth(p: Poly, iterations: number): Poly {
  let cur = p;
  for (let k = 0; k < iterations; k++) {
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]!;
      const b = cur[(i + 1) % cur.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    cur = next;
  }
  return cur;
}

/**
 * A letra inteira: contornos de fora com os furos dentro deles, já suavizados. `minArea` descarta
 * sujeira de anti-aliasing (laços minúsculos).
 */
export function outlines(inside: (x: number, y: number) => boolean, w: number, h: number, minArea = 6, smoothing = 0): Outline[] {
  const loops = traceLoops(inside, w, h)
    .map((l) => smooth(simplify(dropCollinear(l), 0.6), smoothing))
    .filter((l) => Math.abs(area(l)) >= minArea);
  // com as arestas como estão em traceLoops, o contorno de fora tem área negativa e o furo, positiva
  const outers = loops.filter((l) => area(l) < 0);
  const holes = loops.filter((l) => area(l) > 0);
  const res: Outline[] = outers.map((o) => ({ outer: o, holes: [] }));
  for (const hole of holes) {
    let best: Outline | null = null;
    for (const o of res) {
      if (inPoly(hole[0]!, o.outer) && (!best || Math.abs(area(o.outer)) < Math.abs(area(best.outer)))) best = o;
    }
    best?.holes.push(hole);
  }
  return res;
}
