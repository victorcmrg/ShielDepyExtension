// Mascotes no relógio dos loops lentos (ambient.ts): a animação original (SVGator → CSS) mexe em caminhos
// e grupos do SVG, roda no thread principal e refaz o layout do desenho a cada quadro. Para um personagem
// em loop lento, 20 quadros por segundo bastam (12 no modo leve), e só enquanto ele está na tela.
import { ambient } from '../ambient';

export function throttleMascot(root: Element | null, prefix: string): () => void {
  return ambient(root, (name) => name.startsWith(prefix));
}
