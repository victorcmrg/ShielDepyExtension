// No dia a dia: cartões com pequenas animações (motion design em CSS). Elas só rodam com o bloco na tela.
import { useEffect, useRef } from 'react';
import { reduceMotion } from '../motion';
import { SplitTitle } from '../parts';

const LANGS: [string, string][] = [
  ['TypeScript', 'árvore sintática'],
  ['Java', 'leitura das regras'],
  ['Python', 'leitura das regras'],
  ['C#', 'leitura das regras'],
  ['PL/pgSQL', 'triggers do banco'],
  ['JavaScript', 'árvore sintática'],
  ['TypeScript', 'árvore sintática'],
];

export function Bento() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bento = ref.current!;
    if (reduceMotion() || !('IntersectionObserver' in window)) {
      bento.classList.toggle('playing', !reduceMotion());
      return;
    }
    const io = new IntersectionObserver((entries) => bento.classList.toggle('playing', entries[0]!.isIntersecting));
    io.observe(bento);
    return () => io.disconnect();
  }, []);

  return (
    <section className="bento-wrap" id="recursos" aria-labelledby="bentoTitle">
      <div className="section-head center">
        <SplitTitle id="bentoTitle" accent="time." text="Feito para o dia a dia do time." />
      </div>
      <div className="bento" id="bento" ref={ref}>
        <article className="bento-card tall">
          <div className="bc-art art-menu" aria-hidden="true">
            <ul className="menu">
              <li>
                <span className="mi mi-blue">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 5h16v10H9l-5 4z" />
                  </svg>
                </span>
                <div>
                  <strong>Explicar</strong>
                  <span>A IA explica a colisão que o motor provou.</span>
                </div>
              </li>
              <li>
                <span className="mi mi-gray">
                  <svg viewBox="0 0 24 24">
                    <path d="M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4V20h3.6l6.3-6.3A4.5 4.5 0 1 0 14.5 4z" />
                  </svg>
                </span>
                <div>
                  <strong>Corrigir</strong>
                  <span>Proposta testada numa cópia do grafo antes do "Aplicar".</span>
                </div>
              </li>
              <li>
                <span className="mi mi-green">
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
                  </svg>
                </span>
                <div>
                  <strong>Barrar</strong>
                  <span>O CI bloqueia o merge com colisão crítica.</span>
                </div>
              </li>
              <li>
                <span className="mi mi-pink">
                  <svg viewBox="0 0 24 24">
                    <ellipse cx="12" cy="6" rx="7" ry="3" />
                    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
                  </svg>
                </span>
                <div>
                  <strong>Ler produção</strong>
                  <span>Os triggers do Postgres entram no mapa.</span>
                </div>
              </li>
            </ul>
          </div>
          <h3>Simples</h3>
          <p>Do editor ao banco em produção, cada passo acontece onde você já trabalha.</p>
        </article>

        <article className="bento-card">
          <div className="bc-art art-status" aria-hidden="true">
            <div className="status-pill">
              <span className="sp-a">
                <i className="spin" />
                Analisando
              </span>
              <span className="sp-b">
                <i className="ok" />
                Protegido
              </span>
            </div>
          </div>
          <h3>Seguro</h3>
          <p>
            Só liga nos repositórios liberados.
            <br />
            Sua chave de IA fica com você.
          </p>
        </article>

        <article className="bento-card">
          <div className="bc-art art-steps" aria-hidden="true">
            <ol className="steps">
              <li>
                <i />
                <strong>Arquivo salvo</strong>
                <time>14:02:07</time>
              </li>
              <li>
                <i />
                <strong>Reindexado</strong>
                <time>14:02:07</time>
              </li>
              <li>
                <i />
                <strong>Colisões provadas</strong>
                <time>14:02:08</time>
              </li>
            </ol>
          </div>
          <h3>Rápido</h3>
          <p>
            Reindexa apenas arquivos modificados.
            <br />
            com avisos em tempo real.
          </p>
        </article>

        <article className="bento-card">
          <div className="bc-art art-langs" aria-hidden="true">
            <div className="lang-card">
              <div className="lang-window">
                <ul className="lang-ticker">
                  {LANGS.map(([name, how], i) => (
                    <li key={i}>
                      <strong>{name}</strong>
                      <span>{how}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <span className="lang-dots">
                <i className="sq" />
                <i className="tri" />
                <i className="dot" />
              </span>
            </div>
          </div>
          <h3>Abrangente</h3>
          <p>
            Funcionalidade abrangente.
            <br />
            para maior compatibilidade.
          </p>
        </article>

        <article className="bento-card">
          <div className="bc-art art-shapes" aria-hidden="true">
            <div className="shapes">
              <span className="pointer">
                <svg viewBox="0 0 24 24">
                  <path d="M12 20 4 9h16z" />
                </svg>
              </span>
              <span className="shape s-red">
                <i className="sq" />
              </span>
              <span className="shape s-yellow">
                <i className="tri" />
              </span>
              <span className="shape s-mint">
                <i className="dot" />
              </span>
              <span className="shape s-brand">
                <i className="ok" />
              </span>
            </div>
            <ul className="shape-labels">
              <li>Importante</li>
              <li>Atenção</li>
              <li>Leve</li>
              <li>Protegido</li>
            </ul>
          </div>
          <h3>Claro</h3>
          <p>
            Cada gravidade claramente definida.
            <br />
            Agilizando produção.
          </p>
        </article>
      </div>
    </section>
  );
}
