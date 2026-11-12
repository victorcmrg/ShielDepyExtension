// O contorno das letras para o 3D (decisão 0040): a grade de pixels vira o contorno de fora e os furos.
import { describe, expect, it } from 'vitest';
import { area, inPoly, outlines, traceLoops } from '../src/portal/pages/entrar/contour';

/** Uma grade a partir de linhas de texto: '#' é dentro. */
const grid = (rows: string[]) => {
  const h = rows.length;
  const w = rows[0]!.length;
  return { w, h, inside: (x: number, y: number) => rows[y]![x] === '#' };
};

describe('contorno das letras', () => {
  it('um quadrado cheio vira um laço só, com a área do quadrado', () => {
    const g = grid(['....', '.##.', '.##.', '....']);
    const loops = traceLoops(g.inside, g.w, g.h);
    expect(loops).toHaveLength(1);
    expect(Math.abs(area(loops[0]!))).toBe(4);
  });

  it('um anel (como o "0") vira um contorno de fora com um furo dentro', () => {
    const rows = ['..........', '.########.', '.########.', '.##....##.', '.##....##.', '.##....##.', '.########.', '.########.', '..........'];
    const g = grid(rows);
    const out = outlines(g.inside, g.w, g.h, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.holes).toHaveLength(1);
    expect(inPoly([5, 4.5], out[0]!.holes[0]!)).toBe(true);
    expect(inPoly([5, 4.5], out[0]!.outer)).toBe(true);
    expect(Math.abs(area(out[0]!.outer))).toBeGreaterThan(Math.abs(area(out[0]!.holes[0]!)));
  });

  it('duas peças separadas (como o "i" e o pingo) viram dois contornos', () => {
    const g = grid(['.##.', '....', '.##.', '.##.', '.##.']);
    const out = outlines(g.inside, g.w, g.h, 1);
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.holes.length === 0)).toBe(true);
  });

  it('pixels que só se tocam pela quina não travam o traçado', () => {
    const g = grid(['##..', '##..', '..##', '..##']);
    const loops = traceLoops(g.inside, g.w, g.h);
    const total = loops.reduce((a, l) => a + Math.abs(area(l)), 0);
    expect(total).toBe(8);
  });

  it('a sujeira de borda (laços minúsculos) sai', () => {
    const g = grid(['#.....', '......', '..####', '..####', '..####']);
    const out = outlines(g.inside, g.w, g.h, 4);
    expect(out).toHaveLength(1);
  });
});
