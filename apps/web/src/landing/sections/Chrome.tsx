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
/** Os confetes do mascote: direção, distância, giro e atraso fixos (o HTML é pré-renderizado: nada de
 *  sorteio no render). Saem para os dois lados, um pouco para cima, e caem. */
const CONFETTI = Array.from({ length: 15 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const k = (i * 37) % 15; // espalha sem padrão visível
  return {
    dx: side * (170 + k * 26),
    dy: -(90 + ((i * 53) % 15) * 14),
    r: side * (200 + k * 34),
    d: ((i * 29) % 15) * 14,
    c: ['#12f07a', '#5ef58c', '#b6fbb0', '#2bd96f', '#e9ffe6'][i % 5]!,
  };
});

export function Footer() {
  // o ano entra no navegador (o HTML é pré-renderizado no build e não pode congelar o ano de lá)
  const yearRef = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    yearRef.current!.textContent = String(new Date().getFullYear());
  }, []);
  // a festa do fim: 2 s depois de a tela final ocupar a janela, o mascote pula de baixo (com sombra) e
  // solta os confetes; saindo da tela, ele volta a se esconder para a próxima chegada
  useEffect(() => {
    const finale = ref.current!;
    // o jeito de cada confete vai pelo JS (a CSP da API não deixa style inline no HTML pré-renderizado)
    finale.querySelectorAll<HTMLElement>('.finale-confetti i').forEach((el, i) => {
      const c = CONFETTI[i]!;
      el.style.setProperty('--dx', `${c.dx}px`);
      el.style.setProperty('--dy', `${c.dy}px`);
      el.style.setProperty('--r', `${c.r}deg`);
      el.style.setProperty('--d', `${c.d}ms`);
      el.style.setProperty('--c', c.c);
    });
    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        if (entry!.isIntersecting) timer = window.setTimeout(() => finale.classList.add('is-party'), 2000);
        else finale.classList.remove('is-party');
      },
      { threshold: 0.6 }
    );
    io.observe(finale);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <footer className="finale" id="fim" data-pause ref={ref}>
      {/* o Enterprise ("Falar com o time") aponta para #contato */}
      <span id="contato" className="finale-anchor" aria-hidden="true" />
      <div className="finale-glow" aria-hidden="true" />
      <div className="finale-middle">
        <p className="finale-lede">Do grafo à prova, cada ligação do seu sistema verificada antes de chegar em produção.</p>
      </div>
      <p className="finale-word" aria-label="ShielDepy">
        <span className="finale-word-box">
          <span className="finale-word-fill" aria-hidden="true">
            ShielDepy
          </span>
          <span className="finale-buddy" aria-hidden="true">
            <span className="finale-buddy-shadow" />
            <img src="/mascote-festa.webp" alt="" width="1300" height="1341" loading="lazy" decoding="async" />
            <span className="finale-confetti">
              {CONFETTI.map((c, i) => (
                <i key={i} />
              ))}
            </span>
          </span>
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
