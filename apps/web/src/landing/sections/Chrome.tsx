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
/** As cores dos confetes: os verdes do mascote. */
const CONFETTI_COLORS = ['#12f07a', '#5ef58c', '#b6fbb0', '#2bd96f', '#e9ffe6'];
const CONFETTI_COUNT = 15;

/**
 * Joga os confetes com física de papel: cada um sai com velocidade, tamanho e giro sorteados (a cada festa
 * um arremesso diferente), sobe, perde força e cai com gravidade e resistência do ar (a velocidade tende a
 * um limite, então ele flutua), girando e virando como papel. A trajetória é calculada e vira keyframes.
 */
function throwConfetti(pieces: HTMLElement[], scale: number) {
  const G = 1700 * scale; // gravidade (px/s²)
  const K = 1.5; // resistência do ar (1/s): velocidade limite G/K
  const STEPS = 28;
  pieces.forEach((el, i) => {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const side = i % 2 ? 1 : -1;
    const vx = side * rnd(520, 1400) * scale;
    const vy = -rnd(620, 1250) * scale;
    const spin = rnd(-900, 900);
    const flip = rnd(5, 11); // viradas por segundo (o papel mostrando a borda)
    const w = rnd(8, 15);
    const h = rnd(11, 20);
    const dur = rnd(1.9, 2.8);
    const delay = rnd(0, 160);
    el.style.width = `${w.toFixed(1)}px`;
    el.style.height = `${h.toFixed(1)}px`;
    el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    const frames: Keyframe[] = [];
    for (let s = 0; s <= STEPS; s++) {
      const t = (s / STEPS) * dur;
      const e = 1 - Math.exp(-K * t);
      const x = (vx / K) * e;
      const y = (G * t) / K + ((vy - G / K) / K) * e;
      const r = spin * t;
      const fx = Math.cos(t * flip * Math.PI);
      frames.push({
        offset: s / STEPS,
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(0)}deg) scaleX(${fx.toFixed(2)})`,
        opacity: s / STEPS < 0.75 ? 1 : (1 - s / STEPS) / 0.25,
      });
    }
    el.animate(frames, { duration: dur * 1000, delay, easing: 'linear', fill: 'both' });
  });
}

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
    const box = finale.querySelector<HTMLElement>('.finale-word-box')!;
    const buddy = finale.querySelector<HTMLElement>('.finale-buddy')!;
    const pieces = Array.from(finale.querySelectorAll<HTMLElement>('.finale-confetti i'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // No celular a palavra fica no meio de uma tela alta: com as frações do desktop o mascote ficaria
    // pequeno, inteiro e flutuando. Lá ele chega à mesma altura relativa à palavra (o topo da imagem nos
    // 51,72% da caixa), menor, e o corpo vai até a borda de baixo, que corta ~38% dele (como no desktop):
    // nem no alto do pulo (+5%) os pés aparecem, então ele não sai do chão.
    const layout = () => {
      if (window.innerWidth >= 760) {
        for (const p of ['left', 'top', 'width'] as const) buddy.style.removeProperty(p);
        return;
      }
      const b = box.getBoundingClientRect();
      const f = finale.getBoundingClientRect();
      const top = b.height * 0.5172;
      const h = (f.bottom - (b.top + top)) / 0.62;
      const w = Math.min(h / 1.0315, window.innerWidth * 0.95);
      buddy.style.width = `${w.toFixed(1)}px`;
      buddy.style.top = `${top.toFixed(1)}px`;
      buddy.style.left = `${(b.width * 0.5029 - w / 2).toFixed(1)}px`;
    };
    layout();
    // a caixa da palavra muda quando a fonte (Manrope) chega: refaz a conta (a tela final em si não muda)
    const ro = new ResizeObserver(layout);
    ro.observe(finale);
    ro.observe(box);
    void document.fonts?.ready.then(layout);

    let timer = 0;
    let confettiTimer = 0;
    const reset = () => {
      finale.classList.remove('is-party');
      window.clearTimeout(confettiTimer);
      for (const el of pieces) el.getAnimations().forEach((a) => a.cancel());
    };
    const party = () => {
      layout();
      finale.classList.add('is-party');
      // os confetes saem quando o mascote chega lá em cima (a força do arremesso acompanha o tamanho dele)
      if (!reduce) confettiTimer = window.setTimeout(() => throwConfetti(pieces, Math.min(1, Math.max(0.45, buddy.offsetWidth / 715))), 420);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        if (entry!.isIntersecting) timer = window.setTimeout(party, 2000);
        else reset();
      },
      { threshold: 0.6 }
    );
    io.observe(finale);
    return () => {
      io.disconnect();
      ro.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(confettiTimer);
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
              {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
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
