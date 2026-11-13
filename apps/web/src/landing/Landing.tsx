// Landing do ShielDepy. O React desenha a página (no build ela já sai pré-renderizada em HTML e aqui só
// hidrata); o movimento é um laço de rolagem que escreve variáveis CSS (--p, --sp, --tilt, --draw…) e o
// CSS faz o resto. Nenhuma seção re-renderiza por quadro. Respeita prefers-reduced-motion.
import { useEffect, useRef } from 'react';
import { prefetchEntrarVideo } from '../shared/entrarVideo';
import { initGlass, initLoops, initPauseOffscreen, initReveal, initSpotlight } from './enhance';
import { idle } from './motion';
import { Bento } from './sections/Bento';
import { Closing, Footer, TopNav } from './sections/Chrome';
import { Demo } from './sections/Demo';
import { Hero } from './sections/Hero';
import { Pricing } from './sections/Pricing';
import { Proof } from './sections/Proof';
import { Security } from './sections/Security';
import { Showcase } from './sections/Showcase';
import { Story } from './sections/Story';

export function Landing() {
  const glassDefs = useRef<SVGSVGElement>(null);

  // efeitos de página inteira: rodam depois dos efeitos das seções (os filhos montam antes do pai)
  useEffect(() => {
    const offs = [initReveal(), initPauseOffscreen(), initSpotlight(), initGlass(glassDefs.current), initLoops()];
    // o vídeo do "Entrar" (decisão 0043) vai para o cache depois que a landing carregou, num momento
    // ocioso: ao clicar em "Entrar", ele já está pronto
    const prefetch = () => idle(prefetchEntrarVideo, 4000);
    if (document.readyState === 'complete') prefetch();
    else window.addEventListener('load', prefetch, { once: true });
    offs.push(() => window.removeEventListener('load', prefetch));
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <>
      {/* Filtros do "vidro líquido": o enhance.ts gera um mapa de refração para cada peça de vidro (Chromium). */}
      <svg className="defs" id="glassDefs" aria-hidden="true" focusable="false" ref={glassDefs} />

      <TopNav />

      <main>
        <Hero />
        <Demo />
        <Story />
        <Showcase />
        <Proof />
        <Bento />
        <Security />
        <Pricing />
        <Closing />
      </main>

      <Footer />
    </>
  );
}
