import { describe, expect, it } from 'vitest';
import { badgeFor } from '../src/views/explorerBadge';

describe('selo do arquivo no Explorer: as formas de cada tipo de achado', () => {
  it('mostra a forma de cada tipo presente, do mais grave ao mais leve', () => {
    expect(badgeFor({ error: 5, warning: 2, info: 0 })).toBe('■▲');
    expect(badgeFor({ error: 0, warning: 1, info: 3 })).toBe('▲●');
    expect(badgeFor({ error: 1, warning: 0, info: 0 })).toBe('■');
  });
  it('com os três tipos, ficam os dois mais graves (o VS Code aceita 2 caracteres)', () => {
    const b = badgeFor({ error: 1, warning: 1, info: 1 });
    expect(b).toBe('■▲');
    expect(b.length).toBeLessThanOrEqual(2);
  });
  it('sem achado, sem selo', () => {
    expect(badgeFor({ error: 0, warning: 0, info: 0 })).toBe('');
  });
});
