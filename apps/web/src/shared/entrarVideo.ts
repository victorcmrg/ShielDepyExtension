// O vídeo pré-renderizado do "Entrar" (decisão 0043): qual arquivo tocar e o pré-carregamento na
// landing. Usado pelas duas páginas (a landing pré-carrega, o /entrar toca), por isso fica em shared.
//
// O vídeo foi renderizado em 1920×1080 (16:9). Em telas de formato parecido ele cobre a tela inteira
// (object-fit: cover, cortando no máximo uma faixa fina); em tela em pé (celular) ou muito diferente,
// a encenação roda ao vivo, como antes. Sem movimento (prefers-reduced-motion), nada de vídeo.

export interface EntrarVideo {
  src: string;
  type: string;
  poster: string;
}

export const ENTRAR_POSTER = '/video/poster.webp';
const AV1 = { src: '/video/entrar-av1.webm', type: 'video/webm; codecs="av01.0.09M.10, opus"' };
const H264 = { src: '/video/entrar-h264.mp4', type: 'video/mp4; codecs="avc1.64002A, mp4a.40.2"' };

/** O vídeo que esta tela e este navegador vão tocar, ou null para a encenação ao vivo. */
export function pickEntrarVideo(): EntrarVideo | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  // ?capture é a própria captura do vídeo; ?live força a encenação ao vivo
  if (q.has('capture') || q.has('live')) return null;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  const ar = window.innerWidth / window.innerHeight;
  if (ar < 1.3 || ar > 2.4) return null;
  const v = document.createElement('video');
  if (v.canPlayType(AV1.type) === 'probably') return { ...AV1, poster: ENTRAR_POSTER };
  if (v.canPlayType(H264.type)) return { ...H264, poster: ENTRAR_POSTER };
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
