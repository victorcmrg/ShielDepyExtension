// Entrada de SSR usada só no build (vite build --ssr): gera o HTML estático da landing, que o
// scripts/prerender.mjs injeta no dist/index.html. Primeira pintura sem esperar o JS, como a página
// estática de antes; o React hidrata por cima.
import { renderToString } from 'react-dom/server';
import { Landing } from './Landing';

export function render(): string {
  return renderToString(<Landing />);
}
