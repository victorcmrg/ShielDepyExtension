// Peças de markup repetidas na landing. Sem style inline: a landing sai pré-renderizada em HTML e a CSP
// (style-src 'self') bloquearia atributos style="" — os --i/atrasos são aplicados depois, pelo enhance.ts.
import { Fragment, type ReactNode } from 'react';

/**
 * Título que entra palavra por palavra (.split → cada palavra num .sw). `accent` lista as palavras
 * pintadas com a tinta da marca, separadas por "|", exatamente como aparecem no texto (com pontuação).
 */
export function SplitTitle({ id, text, accent = '', className = 'section-title' }: { id?: string; text: string; accent?: string; className?: string }) {
  const accents = accent.split('|');
  return (
    <h2 className={className + ' split'} id={id}>
      {text
        .trim()
        .split(/\s+/)
        .map((w, i) => (
          <Fragment key={i}>
            <span className={accents.includes(w) ? 'sw tw-accent' : 'sw'}>{w}</span>{' '}
          </Fragment>
        ))}
    </h2>
  );
}

/** Botão verde: a camada de tinta que desliza é um <span> de verdade (um ::before animado não vai para a GPU). */
export function BrandButton({ href, className = '', children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={'button button-brand' + (className ? ' ' + className : '')}>
      <span className="btn-tex" aria-hidden="true" />
      {children}
    </a>
  );
}

export const Lede = ({ className = '', children }: { className?: string; children: ReactNode }) => (
  <p className={(className ? className + ' ' : '') + 'section-lede reveal'}>{children}</p>
);
