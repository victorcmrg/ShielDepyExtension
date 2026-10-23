// O painel da extensão: cartão 3D que endireita ao rolar; cada item da lista acende a parte do painel
// correspondente; os números contam ao aparecer.
import { memo, useEffect, useRef, useState, type Ref } from 'react';
import { clamp, put, reduceMotion } from '../motion';
import { Lede, SplitTitle } from '../parts';
import { addScrollJob } from '../scroll';

type Part = 'tiles' | 'list' | 'balloon';

const POINTS: { focus: Part; num: string; title: string; shapes?: boolean; text: string }[] = [
  { focus: 'tiles', num: '01', title: 'Por gravidade ', shapes: true, text: 'Importante, Atenção e Leve no topo, cada um com a sua forma.' },
  { focus: 'list', num: '02', title: 'Por arquivo', text: 'Cada arquivo com o número de problemas dele, do mais grave para o mais leve.' },
  { focus: 'balloon', num: '03', title: 'O outro lado da colisão', text: 'Encontre o local exato do erro diretamente sem procurar.' },
];

export function Showcase() {
  const [focus, setFocus] = useState<Part | null>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tiltStage = tiltRef.current!;
    const panel = panelRef.current!;
    const reduce = reduceMotion();
    let tiltTop = 0;
    let counted = false;

    function countUp() {
      if (counted) return;
      counted = true;
      panel.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
        const to = Number(el.dataset.count);
        if (reduce) {
          el.textContent = String(to);
          return;
        }
        const t0 = performance.now();
        const tick = (now: number) => {
          const k = clamp((now - t0) / 900);
          el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }

    return addScrollJob({
      measure() {
        tiltTop = tiltStage.getBoundingClientRect().top + window.scrollY;
      },
      frame() {
        // Cartão do painel: entra inclinado e endireita ao chegar perto do meio da tela.
        const vh = window.innerHeight;
        const t = clamp((vh - (tiltTop - window.scrollY)) / (vh * 0.75));
        const tl = reduce ? 0 : (1 - t) * 32;
        const lf = reduce ? 0 : (1 - t) * 60;
        const sc = reduce ? 1 : 0.9 + t * 0.1;
        put(panel, 'transform', `rotateX(${tl.toFixed(2)}deg) translateY(${lf.toFixed(1)}px) scale(${sc.toFixed(3)})`);
        put(panel, 'box-shadow', `0 60px 120px -60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(16, 239, 124, ${(t * 0.25).toFixed(3)})`);
        if (t > 0.6) countUp();
      },
    });
  }, []);

  return (
    <section className="showcase" id="produto" aria-labelledby="showcaseTitle">
      <div className="showcase-grid">
        <div className="showcase-copy">
          <SplitTitle id="showcaseTitle" accent="destaque," text="O que importa em destaque, fácil de localizar." />
          <Lede>A lista de erros da extensão organiza tudo para você.</Lede>
          <ol className="showcase-points stagger" id="showcasePoints">
            {POINTS.map((p) => (
              <li
                key={p.focus}
                data-focus={p.focus}
                className={focus === p.focus ? 'on' : undefined}
                onPointerEnter={() => setFocus(p.focus)}
                onPointerLeave={() => setFocus(null)}
              >
                <span className="sp-num">{p.num}</span>
                <div>
                  <strong>
                    {p.title}
                    {p.shapes && (
                      <>
                        <i className="sq" />
                        <i className="tri" />
                        <i className="dot" />
                      </>
                    )}
                  </strong>
                  <p>{p.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="tilt-stage" id="tiltStage" ref={tiltRef}>
          <PanelMock ref={panelRef} focus={focus} />
        </div>
      </div>
    </section>
  );
}

/** O painel em si. memo: trocar o foco só mexe no data-focus — os números (escritos pelo countUp) ficam. */
const PanelMock = memo(function PanelMock({ focus, ref }: { focus: Part | null; ref: Ref<HTMLDivElement> }) {
  return (
    <div className="panel-mock glass-soft" id="panelMock" ref={ref} data-focus={focus ?? undefined}>
      <div className="pm-head">
        <strong>Protetor de código</strong>
        <span>Acme / Projeto Pedidos</span>
      </div>
      <div className="pm-tiles" data-part="tiles">
        <div className="pm-tile">
          <b data-count="25">0</b>
          <span>Importante</span>
          <i className="sq" />
        </div>
        <div className="pm-tile">
          <b data-count="3">0</b>
          <span>Atenção</span>
          <i className="tri" />
        </div>
        <div className="pm-tile">
          <b data-count="1">0</b>
          <span>Leve</span>
          <i className="dot" />
        </div>
      </div>
      <p className="pm-label">Problemas</p>
      <div className="pm-list" data-part="list">
        <div className="pm-row open">
          <i className="sq" />
          <div>
            <strong>TaxHandler.cs</strong>
            <span>pedidos-mediatr/services/tax</span>
          </div>
          <em>4</em>
        </div>
        <div className="pm-finding">
          <i className="sq" />
          <div>
            <strong>Escrita dupla em "total" no evento OrderUpdated.</strong>
            <span>
              <b>#4</b> Linha 9 <em>com PricingHandler.cs</em>
            </span>
            <div className="pm-balloon" data-part="balloon">
              <p>
                <b>PricingHandler.cs</b> linha 9
              </p>
              <pre>
                <i>8</i>
                {'{\n'}
                <i className="hl">9</i>
                {'    notification.Total = notification.Subtotal * 0.9m;\n'}
                <i>10</i>
                {'    return Task.CompletedTask;'}
              </pre>
            </div>
          </div>
        </div>
        <div className="pm-row">
          <i className="sq" />
          <div>
            <strong>PricingListener.java</strong>
            <span>pedidos-spring/services/pricing</span>
          </div>
          <em>3</em>
        </div>
        <div className="pm-row">
          <i className="tri" />
          <div>
            <strong>AuditHandler.cs</strong>
            <span>pedidos-mediatr/services/audit</span>
          </div>
          <em>1</em>
        </div>
      </div>
    </div>
  );
});
