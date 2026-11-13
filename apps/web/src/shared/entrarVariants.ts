// As versões do vídeo do "Entrar" e qual tocar em cada janela (decisão 0043). Puro (sem DOM), para o
// teste e para o entrarVideo.ts.

/** As versões gravadas (largura e altura da tela da gravação). */
export const ENTRAR_VARIANTS = [
  { name: 'entrar-1080', w: 1920, h: 1080 },
  { name: 'entrar-872', w: 1920, h: 872 },
] as const;
/** Entre as duas proporções (1,78 e 2,20), a média geométrica: abaixo dela, a de 1080. O portal.css usa o mesmo corte. */
export const ENTRAR_SPLIT = 1.98;

/** A versão para uma janela de proporção `ar` (null fora da faixa em que o vídeo serve). */
export function variantFor(ar: number): (typeof ENTRAR_VARIANTS)[number] | null {
  if (ar < 1.3 || ar > 2.6) return null;
  return ar < ENTRAR_SPLIT ? ENTRAR_VARIANTS[0] : ENTRAR_VARIANTS[1];
}
