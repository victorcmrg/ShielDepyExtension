// O vídeo pré-renderizado do "Entrar" (decisão 0043): qual arquivo tocar e o pré-carregamento na
// landing. Usado pelas duas páginas (a landing pré-carrega, o /entrar toca), por isso fica em shared.
//
// Há duas versões, cada uma gravada com a tela exata em que vai passar: 1920×1080 (tela cheia, telão)
// e 1920×872 (o navegador numa tela 1080p, descontadas as abas, a barra de endereço e a barra de
// tarefas). A página toca a de proporção mais próxima da janela (object-fit: cover, cortando quase
// nada); em tela em pé (celular) ou muito diferente, a encenação roda ao vivo. Sem movimento
// (prefers-reduced-motion), nada de vídeo.

export interface EntrarVideo {
  src: string;
  type: string;
  poster: string;
}

/** As versões gravadas (largura e altura da tela da gravação). */
export const ENTRAR_VARIANTS = [
  { name: 'entrar-1080', w: 1920, h: 1080 },
  { name: 'entrar-872', w: 1920, h: 872 },
] as const;
/** Entre as duas proporções (1,78 e 2,20), a média geométrica: abaixo dela, a de 1080. O portal.css usa o mesmo corte. */
export const ENTRAR_SPLIT = 1.98;

const AV1 = 'video/webm; codecs="av01.0.09M.10, opus"';
const H264 = 'video/mp4; codecs="avc1.64002A, mp4a.40.2"';

/** A versão para uma janela de proporção `ar` (null fora da faixa em que o vídeo serve). */
export function variantFor(ar: number): (typeof ENTRAR_VARIANTS)[number] | null {
  if (ar < 1.3 || ar > 2.6) return null;
  return ar < ENTRAR_SPLIT ? ENTRAR_VARIANTS[0] : ENTRAR_VARIANTS[1];
}

/** O vídeo que esta tela e este navegador vão tocar, ou null para a encenação ao vivo. */
export function pickEntrarVideo(): EntrarVideo | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  // ?capture é a própria captura do vídeo; ?live força a encenação ao vivo
  if (q.has('capture') || q.has('live')) return null;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const v = variantFor(window.innerWidth / window.innerHeight);
  if (!v) return null;
  const el = document.createElement('video');
  const poster = `/video/${v.name}-poster.webp`;
  if (el.canPlayType(AV1) === 'probably') return { src: `/video/${v.name}-av1.webm`, type: AV1, poster };
  if (el.canPlayType(H264)) return { src: `/video/${v.name}-h264.mp4`, type: H264, poster };
  return null;
}

let prefetched = false;
/**
 * Na landing, depois que ela terminou de carregar: baixa o poster e o vídeo para o cache, com
 * prioridade baixa, para o "Entrar" abrir já pronto. Não baixa em economia de dados.
 */
export function prefetchEntrarVideo(): void {
  if (prefetched) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  const pick = pickEntrarVideo();
  if (!pick) return;
  prefetched = true;
  const img = new Image();
  img.src = pick.poster;
  // lê a resposta até o fim (sem ler, o navegador pode parar o download no meio); o arquivo fica no
  // cache HTTP e o <video> do /entrar o encontra lá
  void fetch(pick.src, { priority: 'low' } as RequestInit)
    .then((r) => r.arrayBuffer())
    .catch(() => {});
}
