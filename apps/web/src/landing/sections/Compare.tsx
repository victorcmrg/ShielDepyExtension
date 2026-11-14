// O comparativo (entre Segurança e Planos, sem aba no menu): em cima, as ferramentas de análise de
// segurança conhecidas, com o pouco do que o ShielDepy faz que elas também fazem; embaixo, o ShielDepy,
// com tudo conferido. Cada grupo tem um mascote quadrado à esquerda e duas colunas de itens.
import { Lede, SplitTitle } from '../parts';

/** O que o ShielDepy faz. `others`: o que Veracode e Checkmarx também oferecem (análise no editor,
 *  portão no CI e correção sugerida por IA); o resto é próprio do ShielDepy. */
const FEATURES: { label: string; others: boolean }[] = [
  { label: 'Análise dentro do editor', others: true },
  { label: 'Portão no CI que barra o merge', others: true },
  { label: 'Correção sugerida por IA', others: true },
  { label: 'Mapa visual de todas as ligações do sistema', others: false },
  { label: 'Ciclos e colisões entre regras provados', others: false },
  { label: 'Agentes do caos testando falhas reais', others: false },
  { label: 'Correção testada numa cópia antes de aplicar', others: false },
  { label: 'Origem de cada erro mostrada no mapa', others: false },
  { label: 'Triggers do Postgres lidos em produção', others: false },
  { label: 'IA local: o código não sai da máquina', others: false },
];

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="cmp-mark ok" aria-label="tem">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.4 6.6 11.4 12.5 4.8" />
      </svg>
    </span>
  ) : (
    <span className="cmp-mark no" aria-label="não tem">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
      </svg>
    </span>
  );
}

function FeatureColumns({ all }: { all: boolean }) {
  return (
    <ul className="cmp-list">
      {FEATURES.map((f) => {
        const ok = all || f.others;
        return (
          <li key={f.label} className={ok ? '' : 'is-missing'}>
            <Mark ok={ok} />
            <span>{f.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Compare() {
  return (
    <section className="compare" id="comparativo" aria-labelledby="compareTitle" data-pause>
      <div className="section-head center">
        <SplitTitle id="compareTitle" accent="continua." text="Onde os outros param, o ShielDepy continua." />
        <Lede>As ferramentas de segurança conhecidas olham o código. O ShielDepy olha o sistema inteiro funcionando.</Lede>
      </div>

      <div className="cmp-group reveal">
        <img className="cmp-mascot" src="/mascote-pensativo.webp" alt="" width="878" height="878" loading="lazy" decoding="async" />
        <div className="cmp-body">
          <div className="cmp-names">
            <h3>Veracode</h3>
            <h3>Checkmarx</h3>
          </div>
          <FeatureColumns all={false} />
        </div>
      </div>

      <hr className="cmp-divider" />

      <div className="cmp-group is-us reveal">
        <img className="cmp-mascot" src="/mascote-confiante.webp" alt="" width="878" height="878" loading="lazy" decoding="async" />
        <div className="cmp-body">
          <div className="cmp-names">
            <h3>ShielDepy</h3>
          </div>
          <FeatureColumns all />
        </div>
      </div>
    </section>
  );
}
