// Planos com o toggle mensal/anual: a pílula desliza até o botão escolhido e os preços trocam com um flip.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reduceMotion } from '../motion';
import { BrandButton, Lede, SplitTitle } from '../parts';

type Billing = 'monthly' | 'yearly';

// Demo grátis, Starter pago (o anual com 20% de desconto) e Enterprise sob consulta (fora daqui).
const PRICES: Record<'demo' | 'starter', Record<Billing, [string, string]>> = {
  demo: { monthly: ['Grátis', 'para sempre'], yearly: ['Grátis', 'para sempre'] },
  starter: { monthly: ['US$30', 'por mês'], yearly: ['US$24', 'por mês, cobrado anualmente'] },
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
          <h3>Demo</h3>
          <p className="plan-for">Para conhecer o ShielDepy no seu projeto.</p>
          <Price plan="demo" billing={billing} flipped={flipped} />
          <a href="/entrar" className="button button-ghost block">
            Começar grátis
          </a>
          <ul>
            <li>Mapa visual (gráfico) das ligações do sistema</li>
            <li>5 rodadas por mês dos agentes do caos</li>
            <li>Extensão para VS Code</li>
            <li>Ciclos e colisões provados sem IA</li>
            <li>1 projeto, CLI para rodar localmente</li>
          </ul>
        </article>

        <article className="plan spot reveal">
          <h3>Starter</h3>
          <p className="plan-for">Para times com o ShielDepy no fluxo de trabalho.</p>
          <Price plan="starter" billing={billing} flipped={flipped} />
          <a href="/entrar" className="button button-ghost block">
            Assinar Starter
          </a>
          <ul>
            <li>Tudo do Demo</li>
            <li>120 rodadas por mês dos agentes do caos</li>
            <li>Chatbot com IA: explicações e correção verificada</li>
            <li>Visualização de erro melhorada, com a origem de cada falha</li>
            <li>Projetos, repositórios e pessoas ilimitados</li>
            <li>Portão no CI para barrar o merge</li>
            <li>Painel com o uso de cada repositório</li>
            <li>Histórico das execuções do caos e relatórios para compartilhar</li>
          </ul>
        </article>

        <article className="plan plan-featured spot reveal">
          <p className="plan-badge">Melhor opção</p>
          <h3>ShielDepy Enterprise</h3>
          <p className="plan-for">Para organizações com exigências de segurança e escala.</p>
          <p className="plan-price">
            <strong>Sob consulta</strong>
          </p>
          <BrandButton href="#contato" className="block">
            Falar com o time
          </BrandButton>
          <ul>
            <li>Tudo do Starter</li>
            <li>Pool personalizada de rodadas dos agentes do caos</li>
            <li>Totalmente seguro, com servidor de IA dedicado: seu código não sai do seu ambiente</li>
            <li>Acesso ao gerenciador staff</li>
            <li>Suporte 24 horas</li>
            <li>Implantação no seu ambiente (nuvem privada ou on-premise)</li>
            <li>Login único (SSO) e permissões por papel</li>
            <li>Registro de auditoria de cada execução</li>
            <li>Leitura dos triggers do Postgres em produção</li>
            <li>Onboarding guiado do time e contrato sob medida</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
