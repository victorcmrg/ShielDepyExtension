// Antes e depois do deploy: a seção gruda e os 4 momentos se alternam com a rolagem (telas largas).
import { useEffect, useRef } from 'react';
import { clamp, put, reduceMotion } from '../motion';
import { SplitTitle } from '../parts';
import { addScrollJob } from '../scroll';

const STEPS = [
  {
    title: 'Enquanto você digita',
    text: 'A extensão reindexa só o arquivo que mudou e marca ciclos e colisões na hora, com a outra ponta do problema ao lado.',
  },
  {
    title: 'Antes de aplicar uma correção',
    text: 'Quando a IA sugere um conserto, o ShielDepy testa a proposta numa cópia do grafo. Só aparece o botão "Aplicar" se nada novo quebrar.',
  },
  { title: 'No pull request', text: 'A CLI roda no seu CI e barra o merge quando encontra uma colisão crítica. Sem servidor nosso no caminho.' },
  {
    title: 'Depois do deploy',
    text: 'Lê os triggers do Postgres em produção e cruza com as regras do código. O que já está no ar também entra no mapa.',
  },
];

const TERM_CI = ` shieldepy report services --fail-on critico

4 regra(s) lida(s) de services
1 balde(s), recurso × evento

3 colisão(ões) detectada(s):

  [write-write]      Order / OrderUpdated, campo "total"
      pricing/PricingListener (pricing/PricingListener.java:11)
      tax/TaxListener (tax/TaxListener.java:12)
      escrevem o mesmo campo

`;

const TERM_PROD = ` shieldepy report --pg postgres://leitura@prod/loja

6 regra(s) lida(s) de postgres (triggers)

  [read-after-write] orders / update, campo "total"
      trg_auditoria lê o que trg_desconto escreve
      → ordem indefinida, resultado imprevisível

`;

export function Story() {
  const storyRef = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const story = storyRef.current!;
    const steps = Array.from(stepsRef.current!.children) as HTMLElement[];
    const screens = Array.from(stageRef.current!.querySelectorAll<HTMLElement>('.frame'));
    const bar = barRef.current!;
    const wide = window.matchMedia('(min-width: 901px)');
    const lay = { top: 0, height: 0 };
    let current = 0; // o markup já nasce no passo 0

    function setStep(i: number) {
      if (i === current) return;
      current = i;
      steps.forEach((s, k) => s.classList.toggle('active', k === i));
      screens.forEach((f, k) => {
        f.classList.toggle('active', k === i);
        f.classList.toggle('past', k < i);
      });
    }

    const stop = addScrollJob({
      measure() {
        lay.top = story.getBoundingClientRect().top + window.scrollY;
        lay.height = story.offsetHeight;
      },
      frame() {
        if (!wide.matches) return;
        const sp = clamp(-(lay.top - window.scrollY) / (lay.height - window.innerHeight));
        put(bar, '--sp', sp.toFixed(3));
        setStep(Math.min(steps.length - 1, Math.floor(sp * steps.length * 0.999)));
      },
    });
    if (!wide.matches) setStep(0);

    // Clicar num passo leva a rolagem até ele.
    const clicks = steps.map((s, i) => {
      const go = () => {
        if (!wide.matches) return;
        const total = story.offsetHeight - window.innerHeight;
        window.scrollTo({ top: story.offsetTop + total * ((i + 0.5) / steps.length), behavior: reduceMotion() ? 'auto' : 'smooth' });
      };
      s.addEventListener('click', go);
      return () => s.removeEventListener('click', go);
    });
    return () => {
      stop();
      clicks.forEach((off) => off());
    };
  }, []);

  return (
    <section className="story" id="deploy" aria-labelledby="storyTitle" ref={storyRef}>
      <div className="story-sticky">
        <div className="story-copy">
          <SplitTitle id="storyTitle" accent="deploy." text="Segurança antes e depois do deploy." />
          <ol className="story-steps" id="storySteps" ref={stepsRef}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={i === 0 ? 'active' : undefined} data-step={i}>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="story-progress" aria-hidden="true">
            <span id="storyBar" ref={barRef} />
          </div>
        </div>

        <div className="story-stage" aria-hidden="true" ref={stageRef}>
          {/* 0 · editor */}
          <div className="frame screen active" data-screen="0">
            <div className="frame-bar">
              <span />
              <span />
              <span />
              <em>PricingHandler.cs</em>
            </div>
            <div className="code">
              <div className="ln">
                <i>7</i>
                <span>
                  <b className="k">public class</b> PricingHandler : INotificationHandler&lt;OrderUpdated&gt;
                </span>
              </div>
              <div className="ln">
                <i>8</i>
                <span>{'{'}</span>
              </div>
              <div className="ln hit">
                <i>9</i>
                <span>
                  {'    notification.Total = notification.Subtotal * '}
                  <b className="n">0.9m</b>;
                </span>
                <u className="gutter" />
              </div>
              <div className="ln">
                <i>10</i>
                <span>
                  {'    '}
                  <b className="k">return</b> Task.CompletedTask;
                </span>
              </div>
              <div className="ln">
                <i>11</i>
                <span>{'}'}</span>
              </div>
            </div>
            <div className="hover-card lg" data-lg="card">
              <p className="hc-head">
                <span className="sq" />
                <strong>Importante</strong>
                <span className="muted">#4, linha 9</span>
              </p>
              <p>Escrita dupla em "total" no evento OrderUpdated.</p>
              <p className="hc-label">Afeta TaxHandler.cs, linha 9</p>
              <pre>notification.Total = notification.Subtotal * 1.1m;</pre>
            </div>
          </div>
          {/* 1 · correção verificada */}
          <div className="frame screen" data-screen="1">
            <div className="frame-bar">
              <span />
              <span />
              <span />
              <em>Chat do ShielDepy</em>
            </div>
            <div className="chat">
              <p className="bubble me">Como resolvo o #4?</p>
              <div className="bubble bot">
                <p>
                  Deixe uma regra só responsável por <code>total</code>: o imposto passa a ler o valor já com desconto.
                </p>
                <p className="verified">
                  <span className="check" />
                  Testado numa cópia do grafo: nenhuma colisão nova, nenhum ciclo.
                </p>
                <span className="pill-action">Aplicar correção em PricingHandler.cs</span>
              </div>
            </div>
          </div>
          {/* 2 · CI */}
          <div className="frame screen terminal" data-screen="2">
            <div className="frame-bar">
              <span />
              <span />
              <span />
              <em>CI · pull request #128</em>
            </div>
            <pre className="term">
              <span className="prompt">$</span>
              {TERM_CI}
              <span className="bad">✕ colisão crítica: merge bloqueado (saída 1)</span>
            </pre>
          </div>
          {/* 3 · produção */}
          <div className="frame screen terminal" data-screen="3">
            <div className="frame-bar">
              <span />
              <span />
              <span />
              <em>produção · Postgres</em>
            </div>
            <pre className="term">
              <span className="prompt">$</span>
              {TERM_PROD}
              <span className="warn">▲ 1 risco em regras que já estão no ar</span>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
