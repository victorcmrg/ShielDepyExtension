// A demonstração do pós-login (decisão 0049): o painel de empresas e funcionários conectados, com os
// dados de mentira de demo/data.ts e o mesmo visual do portal (menu lateral, cartões, linhas de
// empresa), mas sem API nem login por trás. Os interruptores e a busca só mudam a tela; nada é salvo.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../../shared/theme';
import { connectedNow, DEMO_COMPANIES, filterCompanies, overviewOf, type DemoCompany, type DemoMember } from '../demo/data';
import { initial, staggerStyle } from '../format';
import type { Overview } from '../types';
import { CountUp, EmptyState, Switch } from '../ui/controls';
import { Icon, type IconName } from '../ui/Icon';

const DEMO_EMAIL = 'voce@shieldepy.test';

const STATS: { key: keyof Overview; label: string; icon: IconName; sub: (o: Overview) => string }[] = [
  { key: 'companies', label: 'Empresas', icon: 'building', sub: (o) => (o.suspendedCompanies ? o.suspendedCompanies + ' suspensa(s)' : 'todas ativas') },
  { key: 'users', label: 'Funcionários ativos', icon: 'users', sub: () => 'já entraram ao menos uma vez' },
  { key: 'pendingInvites', label: 'Convites pendentes', icon: 'mail', sub: () => 'e-mails liberados sem login' },
  { key: 'activeDevices', label: 'VS Codes conectados', icon: 'device', sub: () => 'extensões com acesso válido' },
  { key: 'aiCompanies', label: 'Empresas com IA', icon: 'spark', sub: (o) => 'de ' + o.companies + ' no total' },
];

const ago = (min: number | null): string => {
  if (min === null) return 'nunca entrou';
  if (min < 1) return 'agora mesmo';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.round(h / 24);
  return 'há ' + d + (d === 1 ? ' dia' : ' dias');
};

export default function Demo() {
  const [companies, setCompanies] = useState<DemoCompany[]>(() => DEMO_COMPANIES.map((c) => ({ ...c })));
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([DEMO_COMPANIES[0]!.id]));
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    document.title = 'Painel de empresas (demonstração) — ShielDepy';
  }, []);
  // celular: o menu vira gaveta, pela mesma classe do body que o Shell usa
  useEffect(() => {
    document.body.classList.toggle('side-open', menuOpen);
    return () => document.body.classList.remove('side-open');
  }, [menuOpen]);

  const overview = overviewOf(companies);
  const online = connectedNow(companies);
  const visible = filterCompanies(companies, query);
  const set = (id: number, patch: Partial<DemoCompany>) => setCompanies((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const toggle = (id: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="app-shell demo-shell">
      <aside className="sidebar" id="sidebar" aria-label="Menu">
        <Link to="/" className="side-brand" reloadDocument>
          <img src="/logo-mark.svg" alt="" />
          <span>ShielDepy</span>
        </Link>
        <div className="side-company">
          <span className="side-company-avatar">S</span>
          <div className="side-company-text">
            <strong>ShielDepy</strong>
            <span>Admin da plataforma</span>
          </div>
        </div>
        <nav className="side-nav" aria-label="Navegação principal">
          <a href="#empresas" className="side-link active" aria-current="page">
            <Icon name="globe" />
            <span>Empresas</span>
          </a>
          <a href="#conectados" className="side-link">
            <Icon name="device" />
            <span>Conectados agora</span>
          </a>
        </nav>
        <div className="side-spacer" />
        <p className="side-status">
          <span className="side-status-dot" />
          <span>Demonstração: dados de exemplo</span>
        </p>
        <div className="side-foot">
          <div className="side-user" title={DEMO_EMAIL}>
            <span className="side-user-avatar">{initial(DEMO_EMAIL)}</span>
            <span className="side-user-email">{DEMO_EMAIL}</span>
          </div>
          <div className="side-foot-actions">
            <ThemeToggle className="theme-toggle" />
            <Link className="side-logout" to="/" reloadDocument>
              <Icon name="logout" />
              <span>Sair</span>
            </Link>
          </div>
        </div>
      </aside>
      <div className="side-scrim" id="sideScrim" onClick={() => setMenuOpen(false)} />
      <div className="app-main">
        <header className="topbar">
          <button id="menuToggle" className="icon-btn" type="button" aria-label="Abrir menu" onClick={() => setMenuOpen((o) => !o)}>
            <Icon name="menu" />
          </button>
          <span className="topbar-title">Empresas</span>
        </header>

        <main id="main" className="page">
          <p className="demo-banner" role="note">
            <Icon name="shield" />
            <span>
              <strong>Demonstração.</strong> Empresas e funcionários de exemplo, sem sistema por trás: as mudanças ficam só nesta tela.
            </span>
          </p>

          <section className="page-head spaced" id="empresas">
            <div>
              <h1 className="page-title">Empresas</h1>
              <p className="page-sub">As empresas que usam o ShielDepy, quem trabalha em cada uma e quem está com o VS Code conectado agora.</p>
            </div>
          </section>

          <section className="stat-grid" id="stats">
            {STATS.map((def, i) => (
              <div key={def.key} className="stat-card enter" data-key={def.key} style={staggerStyle(i)}>
                <div className="stat-top">
                  <Icon name={def.icon} />
                  <span className="stat-label">{def.label}</span>
                </div>
                <CountUp as="div" className="stat-value" value={overview[def.key]} />
                <div className="stat-sub">{def.sub(overview)}</div>
              </div>
            ))}
          </section>

          <section className="dash-section" id="conectados">
            <div className="dash-section-head">
              <h2>Conectados agora</h2>
              <span className="badge badge-live">{online.length} online</span>
            </div>
            <ul className="team-rows demo-online">
              {online.map(({ company, member }, i) => (
                <li key={member.email} className="team-row enter" style={staggerStyle(i)}>
                  <div className="team-who">
                    <span className="person-avatar active">{initial(member.name)}</span>
                    <div className="row-main">
                      <span className="row-title">{member.name}</span>
                      <span className="row-meta">{company.name + ' · ' + member.email}</span>
                    </div>
                  </div>
                  <div className="chips">
                    {member.project && <span className="chip">{member.project}</span>}
                  </div>
                  <span className="member-detail">{ago(member.lastSeenMinutesAgo) + ' · ' + member.devices + ' VS Code(s)'}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="dash-section">
            <div className="dash-section-head">
              <h2>Todas as empresas</h2>
              <label className="search-box">
                <Icon name="search" />
                <input type="search" id="search" placeholder="Buscar empresa, nome ou e-mail…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
            <div id="companies" className="company-list">
              {visible.length === 0 ? (
                <EmptyState icon="building" title="Nada encontrado" text={'Nenhuma empresa, nome ou e-mail bate com "' + query.trim() + '".'} />
              ) : (
                visible.map((c, i) => (
                  <CompanyRow
                    key={c.id}
                    company={c}
                    index={i}
                    open={open.has(c.id)}
                    onToggle={() => toggle(c.id)}
                    onActive={(v) => set(c.id, { active: v })}
                    onAi={(v) => set(c.id, { ai: v })}
                  />
                ))
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function CompanyRow(props: { company: DemoCompany; index: number; open: boolean; onToggle: () => void; onActive: (v: boolean) => void; onAi: (v: boolean) => void }) {
  const { company, index, open } = props;
  const active = company.members.filter((x) => x.status === 'active').length;
  const pending = company.members.length - active;
  return (
    <article className={'company-row enter' + (company.active ? '' : ' is-suspended') + (open ? ' open' : '')} style={staggerStyle(index)}>
      <div className="company-head">
        <div className="company-avatar">{initial(company.name)}</div>
        <div className="company-info">
          <div className="company-title">
            <h3>{company.name}</h3>
            {company.active ? <span className="badge badge-ok">Ativa</span> : <span className="badge badge-danger">Suspensa</span>}
            {company.ai && <span className="badge badge-brand">IA</span>}
          </div>
          <p className="company-meta">{active + ' funcionário(s) · ' + pending + ' convite(s) pendente(s) · criada há ' + company.createdDaysAgo + ' dias'}</p>
        </div>
        <div className="company-controls">
          <Switch
            label="Acesso liberado"
            checked={company.active}
            onChange={async (v) => {
              props.onActive(v);
              return true;
            }}
          />
          <Switch
            label="Bot de IA"
            checked={company.ai}
            onChange={async (v) => {
              props.onAi(v);
              return true;
            }}
          />
        </div>
        <div className="company-actions">
          <button className="expand-btn" type="button" onClick={props.onToggle} aria-expanded={open}>
            <span>Funcionários</span>
            <Icon name="chevron" />
          </button>
        </div>
      </div>
      <div className="company-body">
        <div className="company-body-inner">
          <div className="members">
            <ul className="member-list">
              {company.members.map((x) => (
                <MemberRow key={x.email} member={x} suspended={!company.active} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}

function MemberRow({ member, suspended }: { member: DemoMember; suspended: boolean }) {
  const detail =
    member.status === 'pending'
      ? 'convite pendente — ainda não entrou'
      : (suspended ? 'sem acesso (empresa suspensa) · ' : '') + 'visto ' + ago(member.lastSeenMinutesAgo) + ' · ' + member.devices + ' VS Code(s)' + (member.project ? ' · ' + member.project : '');
  return (
    <li className={'member ' + member.status}>
      <div className="member-who">
        <span className="member-dot" />
        <span className="member-email">{member.name}</span>
        {member.role === 'owner' && <span className="badge badge-brand">Dono</span>}
      </div>
      <span className="member-detail">{detail}</span>
      <span className="member-detail demo-email">{member.email}</span>
    </li>
  );
}
