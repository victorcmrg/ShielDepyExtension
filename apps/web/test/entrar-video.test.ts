import { describe, expect, it } from 'vitest';
import { ENTRAR_SPLIT, ENTRAR_VARIANTS, coverStage, variantFor } from '../src/shared/entrarVariants';

describe('vídeo do "Entrar": a versão pela proporção da janela (decisão 0043)', () => {
  it('janela do navegador numa tela 1080p (1920×871) toca a versão 1920×872', () => {
    expect(variantFor(1919 / 871)?.name).toBe('entrar-872');
    expect(variantFor(1920 / 945)?.name).toBe('entrar-872');
  });
  it('tela cheia e telão 16:9 tocam a versão 1920×1080; 16:10 também', () => {
    expect(variantFor(1920 / 1080)?.name).toBe('entrar-1080');
    expect(variantFor(1440 / 900)?.name).toBe('entrar-1080');
  });
  it('o corte fica entre as duas proporções gravadas', () => {
    const [a, b] = ENTRAR_VARIANTS.map((v) => v.w / v.h);
    expect(ENTRAR_SPLIT).toBeGreaterThan(a!);
    expect(ENTRAR_SPLIT).toBeLessThan(b!);
    expect(ENTRAR_SPLIT).toBeCloseTo(Math.sqrt(a! * b!), 2);
  });
  it('tela em pé (celular) ou estreita demais: encenação ao vivo', () => {
    expect(variantFor(390 / 844)).toBeNull();
    expect(variantFor(1)).toBeNull();
    expect(variantFor(3.5)).toBeNull();
  });
  it('o palco: a mesma conta do object-fit: cover (a tela real cai em cima do último quadro)', () => {
    expect(coverStage(1920, 872, 1920, 872)).toEqual({ s: 1, ox: 0, oy: 0 });
    // janela mais larga que a gravação: escala pela largura e corta em cima e embaixo, por igual
    const a = coverStage(1536, 730, 1920, 872);
    expect(a.s).toBeCloseTo(730 / 872, 5);
    expect(a.oy).toBeCloseTo(0, 5);
    expect(1920 * a.s + 2 * a.ox).toBeCloseTo(1536, 5);
    // janela mais alta: escala pela altura e corta dos lados
    const b = coverStage(987, 690, 1920, 1080);
    expect(b.s).toBeCloseTo(690 / 1080, 5);
    expect(b.ox).toBeLessThan(0);
    expect(1080 * b.s).toBeCloseTo(690, 5);
  });
});
