import { describe, expect, it } from 'vitest';
import { ENTRAR_SPLIT, ENTRAR_VARIANTS, variantFor } from '../src/shared/entrarVideo';

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
});
