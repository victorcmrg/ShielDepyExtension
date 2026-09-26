import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Finding } from '@shieldepy/core';
import { computeChangedExcerpt, preserveOutside } from '../src/analysis/excerpt';
import { FindingsCache } from '../src/analysis/FindingsCache';

const lines = (n: number, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i}`);

describe('computeChangedExcerpt', () => {
  it('mesma contagem de linhas: recorta o trecho alterado + contexto', () => {
    const old = lines(100);
    const now = [...old];
    now[50] = 'mudou';
    const ex = computeChangedExcerpt(old.join('\n'), now.join('\n'))!;
    expect([ex.startLine, ex.endLine, ex.lineDelta]).toEqual([42, 58, 0]);
    expect(ex.text.split('\n')[8]).toBe('mudou');
  });

  it('linhas inseridas: ainda recorta (antes caía sempre no arquivo inteiro) e reporta o deslocamento', () => {
    const old = lines(100);
    const now = [...old.slice(0, 50), 'novo1', 'novo2', 'novo3', ...old.slice(50)];
    const ex = computeChangedExcerpt(old.join('\n'), now.join('\n'))!;
    expect(ex.lineDelta).toBe(3);
    expect([ex.startLine, ex.endLine]).toEqual([42, 60]);
    expect(ex.oldChangedEnd).toBe(49);
  });

  it('mudança grande demais → null (manda o arquivo inteiro)', () => {
    expect(computeChangedExcerpt(lines(10).join('\n'), lines(10, 'x').join('\n'))).toBeNull();
    expect(computeChangedExcerpt('a', 'a')).toBeNull();
  });

  it('preserveOutside mantém os de antes, desloca os de depois, descarta os do trecho', () => {
    const old = lines(100);
    const now = [...old.slice(0, 50), 'n1', 'n2', ...old.slice(50)];
    const ex = computeChangedExcerpt(old.join('\n'), now.join('\n'))!;
    const f = (startLine: number) => ({ startLine, endLine: startLine, message: `L${startLine}` });
    const kept = preserveOutside([f(5), f(48), f(80)], ex);
    expect(kept).toEqual([f(5), { startLine: 82, endLine: 82, message: 'L80' }]);
  });
});

describe('FindingsCache', () => {
  const finding = (over: Partial<Finding> = {}): Finding => ({
    file: 'c:/p/a.ts',
    startLine: 1,
    endLine: 1,
    severity: 'warning',
    message: 'm',
    source: 'ia',
    ...over,
  });

  it('#id estável pela `key` mesmo se a IA reescrever a mensagem (item 4.2)', () => {
    const a = FindingsCache.stableId('f', finding({ message: 'Race condition aqui', key: 'ia:warning:x()' }));
    const b = FindingsCache.stableId('f', finding({ message: 'Possível condição de corrida', key: 'ia:warning:x()' }));
    expect(a).toBe(b);
    expect(FindingsCache.stableId('f', finding({ message: 'a' }))).not.toBe(FindingsCache.stableId('f', finding({ message: 'b' })));
  });

  it('persiste, reaproveita firstSeen e poda resolvidos há mais de 30 dias (item 4.3)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-cache-'));
    try {
      let now = new Date('2026-01-01T00:00:00Z');
      const clock = () => now;
      const c1 = new FindingsCache(dir, undefined, clock);
      await c1.load();
      const [first] = c1.record('c:/p/a.ts', [finding({ key: 'k1' })]);
      now = new Date('2026-01-02T00:00:00Z');
      c1.record('c:/p/a.ts', []); // sumiu → resolvido em 02/01
      await c1.dispose();

      now = new Date('2026-01-10T00:00:00Z');
      const c2 = new FindingsCache(dir, undefined, clock);
      await c2.load();
      expect(c2.get(first!.id)?.firstSeen).toBe('2026-01-01T00:00:00.000Z');
      await c2.dispose();

      now = new Date('2026-03-01T00:00:00Z');
      const c3 = new FindingsCache(dir, undefined, clock);
      await c3.load();
      expect(c3.get(first!.id)).toBeUndefined();
      await c3.dispose();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
