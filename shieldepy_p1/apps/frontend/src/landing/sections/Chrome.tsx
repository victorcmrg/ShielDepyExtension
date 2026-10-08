// Moldura da landing: menu de vidro no topo, chamada final e rodapé.
import { useEffect, useRef } from 'react';
import { ThemeToggle } from '../../shared/theme';
import { BrandButton, SplitTitle } from '../parts';
import { addScrollJob } from '../scroll';

export function TopNav() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const topbar = ref.current!;
    return addScrollJob({ frame: () => topbar.classList.toggle('scrolled', window.scrollY > 40) });
  }, []);

  return (
    <header className="topbar" id="topbar" ref={ref}>
      <nav className="nav glass lg" data-lg="nav" aria-label="Principal">
        <a href="#inicio" className="brand">
          <img src="/logo-mark.svg" alt="" width="22" height="22" />
          <span>ShielDepy</span>
        </a>
        <div className="nav-links">
          <a href="#demo">Demo</a>
          <a href="#deploy">Como funciona</a>
          <a href="#prova">A prova</a>
          <a href="#seguranca">Segurança</a>
          <a href="#planos">Planos</a>
        </div>
        <div className="nav-actions">
          <ThemeToggle className="icon-button" />
          <a href="/login" className="link-quiet">
            Entrar
          </a>
          <BrandButton href="#planos" className="small">
            Começar
          </BrandButton>
        </div>
      </nav>
    </header>
  );
}

export function Closing() {
  return (
    <section className="closing" aria-labelledby="closingTitle" data-pause>
      <div className="closing-card spot">
        <span className="tex-move" aria-hidden="true" />
        <SplitTitle id="closingTitle" text="O próximo incidente pode ser apenas um aviso durante a produção." />
        <a href="/login" className="button button-ink">
          Criar conta agora
        </a>
      </div>
    </section>
  );
}

export function Footer() {
  // o ano entra no navegador (o HTML é pré-renderizado no build e não pode congelar o ano de lá)
  const yearRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    yearRef.current!.textContent = String(new Date().getFullYear());
  }, []);
  return (
    <footer className="footer" id="contato">
      <div className="footer-inner">
        <a href="#inicio" className="brand">
          <img src="/logo-mark.svg" alt="" width="20" height="20" />
          <span>ShielDepy</span>
        </a>
        <nav aria-label="Rodapé">
          <a href="#deploy">Como funciona</a>
          <a href="#seguranca">Segurança</a>
          <a href="#planos">Planos</a>
          <a href="/login">Entrar</a>
        </nav>
        <p>
          © <span id="year" ref={yearRef} /> ShielDepy
        </p>
      </div>
    </footer>
  );
}
