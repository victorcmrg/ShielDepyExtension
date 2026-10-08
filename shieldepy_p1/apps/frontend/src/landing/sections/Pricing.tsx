// Planos com o toggle mensal/anual: a pílula desliza até o botão escolhido e os preços trocam com um flip.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reduceMotion } from '../motion';
import { BrandButton, Lede, SplitTitle } from '../parts';

type Billing = 'monthly' | 'yearly';

const PRICES: Record<'starter' | 'complete', Record<Billing, [string, string]>> = {
  starter: { monthly: ['R$99', 'por mês'], yearly: ['R$79', 'por mês, cobrado anualmente'] },
  complete: { monthly: ['R$249', 'por mês'], yearly: ['R$199', 'por mês, cobrado anualmente'] },
};

/** Preço do plano. O <strong> tem key = forma de cobrança: a cada troca ele remonta e o flip roda de novo. */
function Price({ plan, billing, flipped }: { plan: keyof typeof PRICES; billing: Billing; flipped: boolean }) {
  const [value, unit] = PRICES[plan][billing];
  return (
    <p className="plan-price">
      <strong key={billing} className={flipped && !reduceMotion() ? 'flip' : undefined}>
        {value}
      </strong>
      <span>{unit}</span>
    </p>
  );
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>('monthly');
  const [flipped, setFlipped] = useState(false);
  const billingRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // a pílula vai pra baixo do botão escolhido (posição medida: os rótulos têm larguras diferentes)
  const placePill = () => {
    const btn = billingRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    const pill = pillRef.current;
    if (!btn || !pill) return;
    pill.style.setProperty('--x', btn.offsetLeft + 'px');
    pill.style.setProperty('--w', btn.offsetWidth + 'px');
  };
  useLayoutEffect(placePill, [billing]);
  useEffect(() => {
    document.fonts?.ready.then(placePill);
  }, []);

  function choose(next: Billing) {
    if (next === billing) return;
    setBilling(next);
    setFlipped(true);
    const pill = pillRef.current;
    if (pill && !reduceMotion()) {
      pill.classList.remove('moving');
      void pill.offsetWidth;
      pill.classList.add('moving');
    }
  }

  return (
    <section className="pricing" id="planos" aria-labelledby="pricingTitle" data-pause>
      <div className="section-head center">
        <SplitTitle id="pricingTitle" accent="editor." text="Comece no seu editor. Leve para o time." />
        <Lede>Veja qual plano combina mais com seu negócio.</Lede>
        <div className="billing glass" id="billing" role="group" aria-label="Forma de cobrança" ref={billingRef}>
          <span className="billing-pill" id="billingPill" ref={pillRef} />
          <button type="button" aria-pressed={billing === 'monthly'} data-billing="monthly" onClick={() => choose('monthly')}>
            Mensal
          </button>
          <button type="button" aria-pressed={billing === 'yearly'} data-billing="yearly" onClick={() => choose('yearly')}>
            Anual <em>−20%</em>
          </button>
        </div>
      </div>

      <div className="pricing-mesh" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="plans">
        <article className="plan spot reveal">
          <h3>Starter</h3>
          <p className="plan-for">Para validar num projeto real.</p>
          <Price plan="starter" billing={billing} flipped={flipped} />
          <a href="/login" className="button button-ghost block">
            Assinar Starter
          </a>
          <ul>
            <li>Extensão para VS Code</li>
            <li>Ciclos e colisões provados sem IA</li>
            <li>1 projeto, até 3 pessoas</li>
            <li>CLI para rodar localmente</li>
          </ul>
        </article>

        <article className="plan plan-featured spot reveal">
          <p className="plan-badge">Mais escolhido</p>
          <h3>Completo</h3>
          <p className="plan-for">Para times com o ShielDepy no fluxo de trabalho.</p>
          <Price plan="complete" billing={billing} flipped={flipped} />
          <BrandButton href="/login" className="block">
            Assinar Completo
          </BrandButton>
          <ul>
            <li>Tudo do Starter</li>
            <li>Projetos, repositórios e pessoas ilimitados</li>
            <li>IA: explicações, chat e correção verificada</li>
            <li>Portão no CI para barrar o merge</li>
            <li>Painel com o uso de cada repositório</li>
          </ul>
        </article>

        <article className="plan spot reveal">
          <h3>Enterprise</h3>
          <p className="plan-for">Para organizações com exigências de segurança e escala.</p>
          <p className="plan-price">
            <strong>Sob consulta</strong>
          </p>
          <a href="#contato" className="button button-ghost block">
            Falar com o time
          </a>
          <ul>
            <li>Tudo do Completo</li>
            <li>Leitura dos triggers do Postgres em produção</li>
            <li>Implantação no seu ambiente</li>
            <li>Suporte dedicado e contrato sob medida</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
