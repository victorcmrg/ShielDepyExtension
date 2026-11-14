// Plano e faturas: tela real do portal com dados fixos (MVP7, decisão 0028). Não há provedor de
// pagamento, formulário de cartão nem regra de cobrança; o selo "demonstração" diz isso na tela.
import { staggerStyle } from '../format';
import { Icon } from '../ui/Icon';
import { useMe } from '../layout/Shell';

const PLAN = {
  name: 'Starter',
  price: 'US$30',
  cycle: 'por mês',
  renewal: '01/12/2026',
  includes: [
    '120 rodadas por mês dos agentes do caos',
    'Chatbot com IA: explicações e correção verificada',
    'Visualização de erro melhorada, com a origem de cada falha',
    'Projetos, repositórios e pessoas ilimitados',
    'Portão no CI para barrar o merge',
  ],
};

const INVOICES = [
  { id: 'DEMO-0003', period: 'Novembro de 2026', due: '01/11/2026', amount: 'US$ 30,00', paid: true },
  { id: 'DEMO-0002', period: 'Outubro de 2026', due: '01/10/2026', amount: 'US$ 30,00', paid: true },
  { id: 'DEMO-0001', period: 'Setembro de 2026', due: '01/09/2026', amount: 'US$ 30,00', paid: true },
];

export default function Plan() {
  const me = useMe();
  return (
    <>
      <section className="page-head spaced">
        <div>
          <h1 className="page-title">Plano e faturas</h1>
          <p className="page-sub">{me.companyName}. A assinatura da empresa e o histórico de cobranças.</p>
        </div>
        <span className="badge badge-warn" id="demoSeal">
          Demonstração
        </span>
      </section>

      <p className="plan-demo-note">
        <Icon name="alert" />
        <span>Dados fixos, só para demonstração: nada aqui é cobrado e nenhum pagamento é processado.</span>
      </p>

      <div className="dash-columns">
        <section className="dash-section panel-card enter" style={staggerStyle(0)} id="planSection">
          <div className="dash-section-head">
            <h2>Plano {PLAN.name}</h2>
            <span className="badge badge-ok">Ativa</span>
          </div>
          <p className="plan-value">
            <strong>{PLAN.price}</strong> <span>{PLAN.cycle}</span>
          </p>
          <p className="plan-renewal">Próxima renovação em {PLAN.renewal}</p>
          <ul className="plan-includes">
            {PLAN.includes.map((item) => (
              <li key={item}>
                <Icon name="check" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dash-section panel-card enter" style={staggerStyle(1)} id="invoicesSection">
          <div className="dash-section-head">
            <h2>Faturas</h2>
          </div>
          <table className="invoice-table">
            <thead>
              <tr>
                <th scope="col">Período</th>
                <th scope="col">Vencimento</th>
                <th scope="col">Valor</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <strong>{invoice.period}</strong>
                    <span>{invoice.id}</span>
                  </td>
                  <td>{invoice.due}</td>
                  <td>{invoice.amount}</td>
                  <td>
                    <span className="badge badge-ok">Paga</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
