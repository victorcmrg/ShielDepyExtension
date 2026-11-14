// Moldura da landing: menu de vidro no topo, chamada final e rodapé.
import { useEffect, useRef } from 'react';
import { ThemeToggle } from '../../shared/theme';
import { BrandButton, SplitTitle } from '../parts';
import { addScrollJob } from '../scroll';

export function TopNav() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const topbar = ref.current!;
    // na tela de finalização (#fim) o menu sobe e some; rolando de volta para cima, ele desce de novo
    let finaleTop = Infinity;
    return addScrollJob({
      measure: () => {
        const finale = document.getElementById('fim');
        finaleTop = finale ? finale.getBoundingClientRect().top + window.scrollY : Infinity;
      },
      frame: () => {
        topbar.classList.toggle('scrolled', window.scrollY > 40);
        topbar.classList.toggle('is-hidden', window.scrollY + window.innerHeight * 0.5 >= finaleTop);
      },
    });
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
          <a href="#fim">Footer</a>
        </div>
        <div className="nav-actions">
          <ThemeToggle className="icon-button" />
          <a href="/entrar" className="link-quiet">
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

/** A tela de finalização: o rodapé do tamanho da tela, com o ShielDepy grande (a aba "Footer" do menu). */
export function Footer() {
  // o ano entra no navegador (o HTML é pré-renderizado no build e não pode congelar o ano de lá)
  const yearRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    yearRef.current!.textContent = String(new Date().getFullYear());
  }, []);
  return (
    <footer className="finale" id="fim" data-pause>
      {/* o Enterprise ("Falar com o time") aponta para #contato */}
      <span id="contato" className="finale-anchor" aria-hidden="true" />
      <div className="finale-glow" aria-hidden="true" />
      <div className="finale-middle">
        <p className="finale-lede">Do grafo à prova, cada ligação do seu sistema verificada antes de chegar em produção.</p>
      </div>
      <p className="finale-word" aria-label="ShielDepy">
        <span className="finale-word-fill" aria-hidden="true">
          ShielDepy
        </span>
      </p>
      <div className="finale-bottom">
        <span>
          ADS 4 · <span id="year" ref={yearRef} /> ShielDepy
        </span>
        <span>Colisões provadas antes do deploy.</span>
      </div>
    </footer>
  );
}
