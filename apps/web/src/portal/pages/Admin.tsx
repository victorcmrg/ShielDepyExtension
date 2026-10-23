// Plataforma (admin): empresas, liberação de acesso/IA, membros de cada empresa e estatísticas.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { formatDate, initial, relativeTime, staggerStyle } from '../format';
import { useMe } from '../layout/Shell';
import type { Company, Member, Overview } from '../types';
import { CountUp, EmptyState, Switch } from '../ui/controls';
import { Icon, type IconName } from '../ui/Icon';
import { useUi } from '../ui/UiProvider';

const STAT_DEFS: { key: keyof Overview; label: string; icon: IconName; sub: (o: Overview) => string }[] = [
  { key: 'companies', label: 'Empresas', icon: 'building', sub: (o) => (o.suspendedCompanies ? o.suspendedCompanies + ' suspensa(s)' : 'todas ativas') },
  { key: 'users', label: 'Usuários ativos', icon: 'users', sub: () => 'já entraram ao menos uma vez' },
  { key: 'pendingInvites', label: 'Convites pendentes', icon: 'mail', sub: () => 'e-mails liberados sem login' },
  { key: 'activeDevices', label: 'VS Codes conectados', icon: 'device', sub: () => 'tokens de dispositivo válidos' },
  { key: 'aiCompanies', label: 'Empresas com IA', icon: 'spark', sub: (o) => 'de ' + o.companies + ' no total' },
];

export default function Admin() {
  const me = useMe();
  const { modal, run } = useUi();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [members, setMembers] = useState<ReadonlyMap<number, Member[]>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [query, setQuery] = useState('');
  const expandedRef = useLatest(expanded);

  const loadMembers = useCallback(async (companyId: number) => {
    const list = await api<Member[]>('/api/admin/companies/' + companyId + '/members');
    setMembers((m) => new Map(m).set(companyId, list));
  }, []);

  // recarrega tudo; `open` = empresas abertas a recarregar os membros (padrão: as que já estão abertas)
  const refresh = useCallback(
    async (open?: ReadonlySet<number>) => {
      const ids = open ?? expandedRef.current;
      await Promise.all([
        api<Overview>('/api/admin/overview').then(setOverview),
        api<Company[]>('/api/admin/companies').then(async (list) => {
          await Promise.all([...ids].map(loadMembers));
          setCompanies(list);
        }),
      ]);
    },
    [loadMembers]
  );

  useEffect(() => {
    void run(() => refresh());
  }, [run, refresh]);

  async function toggle(company: Company) {
    if (expanded.has(company.id)) {
      setExpanded((s) => without(s, company.id));
      return;
    }
    if (!members.has(company.id)) await run(() => loadMembers(company.id));
    setExpanded((s) => new Set(s).add(company.id));
  }

  async function createCompany() {
    const values = await modal({
      title: 'Nova empresa',
      body: 'Ela nasce com acesso liberado e a IA desligada. O dono entra e monta os projetos, os repositórios e a equipe.',
      fields: [
        { name: 'name', label: 'Nome da empresa', placeholder: 'Ex.: Acme Ltda', required: true },
        { name: 'ownerEmail', label: 'E-mail do dono', type: 'email', placeholder: 'dono@empresa.com', autocomplete: 'off' },
        {
          name: 'ownerPassword',
          label: 'Senha inicial do dono',
          type: 'password',
          placeholder: 'Pelo menos 8 caracteres',
          autocomplete: 'new-password',
          hint: 'Opcional. Sem senha, o dono entra pelo Google ou GitHub.',
        },
      ],
      confirmLabel: 'Criar empresa',
    });
    const name = String(values?.name ?? '').trim();
    if (!values || !name) return;
    await run(async () => {
      const company = await api<Company>('/api/admin/companies', {
        method: 'POST',
        body: { name, ownerEmail: String(values.ownerEmail).trim() || undefined, ownerPassword: values.ownerPassword || undefined },
      });
      const open = new Set(expandedRef.current).add(company.id);
      setExpanded(open);
      await refresh(open);
    }, 'Empresa criada');
  }

  const q = query.trim().toLowerCase();
  const visible = (companies ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q) || (members.get(c.id) ?? []).some((m) => m.email.includes(q))
  );

  return (
    <>
      <section className="page-head spaced">
        <div>
          <h1 className="page-title">Plataforma</h1>
          <p className="page-sub">
            As empresas que usam o ShielDepy. Crie a empresa com o dono, e ele monta os projetos e a equipe. Aqui você libera ou suspende o acesso e a IA.
          </p>
        </div>
        <button id="newCompanyBtn" className="btn-brand" type="button" onClick={createCompany}>
          <Icon name="plus" />
          <span>Nova empresa</span>
        </button>
      </section>

      <section className="stat-grid" id="stats">
        {!overview
          ? STAT_DEFS.map((d) => <div key={d.key} className="stat-card skeleton" />)
          : STAT_DEFS.map((def, i) => (
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

      <section className="dash-section">
        <div className="dash-section-head">
          <h2>Empresas</h2>
          <label className="search-box">
            <Icon name="search" />
            <input type="search" id="search" placeholder="Buscar empresa ou e-mail…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <div id="companies" className="company-list">
          {!companies ? (
            <>
              <div className="company-row skeleton" />
              <div className="company-row skeleton" />
            </>
          ) : companies.length === 0 ? (
            <EmptyState icon="building" title="Nenhuma empresa ainda" text="Crie a primeira empresa pra começar a liberar acessos." />
          ) : visible.length === 0 ? (
            <EmptyState icon="building" title="Nada encontrado" text={'Nenhuma empresa ou e-mail bate com "' + query.trim() + '".'} />
          ) : (
            visible.map((c, i) => (
              <CompanyRow
                key={c.id}
                company={c}
                index={i}
                open={expanded.has(c.id)}
                members={members.get(c.id)}
                myEmail={me.email}
                onToggle={() => toggle(c)}
                onChanged={() => refresh()}
                onDeleted={async () => {
                  const open = without(expandedRef.current, c.id);
                  setExpanded(open);
                  await refresh(open);
                }}
              />
            ))
          )}
        </div>
      </section>
    </>
  );
}

interface CompanyRowProps {
  company: Company;
  index: number;
  open: boolean;
  members: Member[] | undefined;
  myEmail: string;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}

function CompanyRow({ company, index, open, members, myEmail, onToggle, onChanged, onDeleted }: CompanyRowProps) {
  const { modal, run } = useUi();
  const suspended = company.permissions.accessEnabled === false;

  const setPermission = (key: 'accessEnabled' | 'aiEnabled', value: boolean, message: string) =>
    run(async () => {
      await api('/api/admin/companies/' + company.id + '/permissions', { method: 'PATCH', body: { key, value } });
      await onChanged();
    }, message);

  async function rename() {
    const values = await modal({ title: 'Renomear empresa', fields: [{ name: 'name', label: 'Nome', value: company.name, required: true }], confirmLabel: 'Salvar' });
    const name = String(values?.name ?? '').trim();
    if (!values || !name || name === company.name) return;
    await run(async () => {
      await api('/api/admin/companies/' + company.id, { method: 'PATCH', body: { name } });
      await onChanged();
    }, 'Empresa renomeada');
  }

  async function remove() {
    const ok = await modal({
      title: 'Excluir "' + company.name + '"?',
      body: 'Todos os usuários, convites e VS Codes conectados desta empresa são removidos. Não dá pra desfazer.',
      confirmLabel: 'Excluir empresa',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api('/api/admin/companies/' + company.id, { method: 'DELETE' });
      await onDeleted();
    }, 'Empresa excluída');
  }

  return (
    <article className={'company-row enter' + (suspended ? ' is-suspended' : '') + (open ? ' open' : '')} style={staggerStyle(index)}>
      <div className="company-head">
        <div className="company-avatar">{initial(company.name.trim()) || '?'}</div>
        <div className="company-info">
          <div className="company-title">
            <h3>{company.name}</h3>
            {suspended ? <span className="badge badge-danger">Suspensa</span> : <span className="badge badge-ok">Ativa</span>}
            {company.permissions.aiEnabled && <span className="badge badge-brand">IA</span>}
          </div>
          <p className="company-meta">
            {company.memberCount + ' membro(s) · ' + company.pendingCount + ' convite(s) pendente(s) · criada em ' + formatDate(company.createdAt)}
          </p>
        </div>
        <div className="company-controls">
          <Switch
            label="Acesso liberado"
            checked={!suspended}
            onChange={(value) =>
              setPermission('accessEnabled', value, value ? 'Acesso de ' + company.name + ' liberado' : company.name + ' suspensa — as extensões perdem acesso em até 1 min')
            }
          />
          <Switch
            label="Bot de IA"
            checked={Boolean(company.permissions.aiEnabled)}
            onChange={(value) => setPermission('aiEnabled', value, value ? 'IA liberada para ' + company.name : 'IA desligada para ' + company.name)}
          />
        </div>
        <div className="company-actions">
          <button className="icon-btn" type="button" title="Renomear" aria-label="Renomear" onClick={rename}>
            <Icon name="edit" />
          </button>
          <button className="icon-btn danger" type="button" title="Excluir empresa" aria-label="Excluir empresa" onClick={remove}>
            <Icon name="trash" />
          </button>
          <button className="expand-btn" type="button" onClick={onToggle}>
            <span>Membros</span>
            <Icon name="chevron" />
          </button>
        </div>
      </div>
      {/* O conteúdo mora num wrapper interno: a animação de altura (grid 0fr → 1fr) precisa disso. */}
      <div className="company-body">
        <div className="company-body-inner">{members && <Members company={company} members={members} myEmail={myEmail} onChanged={onChanged} />}</div>
      </div>
    </article>
  );
}

function Members({ company, members, myEmail, onChanged }: { company: Company; members: Member[]; myEmail: string; onChanged: () => Promise<void> }) {
  const { modal, run } = useUi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const act = (fn: () => Promise<unknown>, message: string) =>
    run(async () => {
      await fn();
      await onChanged();
    }, message);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await act(
      () => api('/api/admin/companies/' + company.id + '/emails', { method: 'POST', body: { email, initialPassword: password || undefined } }),
      email.trim() + ' liberado em ' + company.name
    );
    setBusy(false);
    if (ok) {
      setEmail('');
      setPassword('');
    }
  }

  async function removeUser(m: Member) {
    const ok = await modal({
      title: 'Remover ' + m.email + '?',
      body: 'A conta é apagada e o e-mail sai da lista de liberados de ' + company.name + '.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (ok) await act(() => api('/api/admin/users/' + m.id, { method: 'DELETE' }), m.email + ' removido');
  }

  return (
    <div className="members">
      {members.length === 0 ? (
        <p className="members-empty">Nenhum e-mail liberado ainda — adicione o primeiro abaixo.</p>
      ) : (
        <ul className="member-list">
          {members.map((m) => {
            const nextRole = m.role === 'owner' ? 'member' : 'owner';
            return (
              <li key={m.email} className={'member ' + m.status}>
                <div className="member-who">
                  <span className="member-dot" />
                  <span className="member-email">{m.email}</span>
                  {m.role === 'owner' && <span className="badge badge-brand">Dono</span>}
                </div>
                <span className="member-detail">
                  {m.status === 'pending'
                    ? 'convite pendente — ainda não entrou'
                    : 'último login ' + relativeTime(m.lastLoginAt) + ' · ' + m.activeDevices + ' VS Code(s)'}
                </span>
                <div className="member-actions">
                  <button
                    className="text-btn"
                    type="button"
                    onClick={() =>
                      act(
                        () => api('/api/admin/emails/' + encodeURIComponent(m.email) + '/role', { method: 'PATCH', body: { role: nextRole } }),
                        m.email + (nextRole === 'owner' ? ' agora é dono' : ' agora é membro')
                      )
                    }
                  >
                    {nextRole === 'owner' ? 'Tornar dono' : 'Tornar membro'}
                  </button>
                  {m.status === 'pending' ? (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => act(() => api('/api/admin/emails/' + encodeURIComponent(m.email), { method: 'DELETE' }), 'Convite de ' + m.email + ' cancelado')}
                    >
                      Cancelar convite
                    </button>
                  ) : (
                    <>
                      {m.activeDevices > 0 && (
                        <button
                          className="text-btn"
                          type="button"
                          onClick={() => act(() => api('/api/admin/users/' + m.id + '/revoke-devices', { method: 'POST' }), 'Dispositivos de ' + m.email + ' desconectados')}
                        >
                          Desconectar VS Codes
                        </button>
                      )}
                      {m.email !== myEmail && (
                        <button className="text-btn danger" type="button" onClick={() => removeUser(m)}>
                          Remover
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="add-member" onSubmit={add}>
        <input type="email" placeholder="pessoa@empresa.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="senha inicial (opcional — mín. 8)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-brand small" type="submit" disabled={busy}>
          <Icon name="plus" />
          <span>Liberar e-mail</span>
        </button>
      </form>
    </div>
  );
}

function without<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.delete(value);
  return next;
}

/** Ref sempre com o valor mais recente — pra callbacks estáveis lerem estado atual sem se recriar. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
