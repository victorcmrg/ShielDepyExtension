// Equipe (só o dono): convidar já escolhendo os projetos, trocar papel e tirar da empresa.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { initial, relativeTime, staggerStyle } from '../format';
import type { Role, Team as TeamData } from '../types';
import { Icon } from '../ui/Icon';
import { useUi } from '../ui/UiProvider';

type TeamMember = TeamData['members'][number];

export default function Team() {
  const { modal, run } = useUi();
  const [data, setData] = useState<TeamData | null>(null);
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setData(await api<TeamData>('/api/team'));
    setLeaving(new Set());
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function invite() {
    if (!data) return;
    const values = await modal({
      title: 'Convidar pessoa',
      body: 'A pessoa entra com este e-mail e a senha inicial, e já cai nos projetos que você marcar.',
      confirmLabel: 'Convidar',
      fields: [
        { name: 'email', label: 'E-mail', type: 'email', placeholder: 'nome@empresa.com', required: true, autocomplete: 'off' },
        {
          name: 'initialPassword',
          label: 'Senha inicial',
          type: 'password',
          placeholder: 'Pelo menos 8 caracteres',
          autocomplete: 'new-password',
          hint: 'Envie para a pessoa por um canal seguro. Ela pode trocar em Minha conta.',
        },
        {
          name: 'role',
          label: 'Papel',
          type: 'select',
          options: [
            { value: 'member', label: 'Membro: usa a ferramenta nos projetos dele' },
            { value: 'owner', label: 'Dono: administra projetos e equipe' },
          ],
        },
        { name: 'projectIds', label: 'Projetos', type: 'checkboxes', options: data.projects.map((p) => ({ value: p.id, label: p.name })), emptyText: 'Nenhum projeto criado ainda.' },
      ],
    });
    if (!values) return;
    const body = { ...values, projectIds: (values.projectIds as string[]).map(Number) };
    if (await run(() => api('/api/team', { method: 'POST', body }), 'Convite criado para ' + values.email)) void run(load);
  }

  async function changeRole(m: TeamMember, next: Role) {
    const setRole = (role: Role) =>
      setData((d) => d && { ...d, members: d.members.map((x) => (x.email === m.email ? { ...x, role } : x)) });
    setRole(next);
    const ok = await run(
      () => api('/api/team/' + encodeURIComponent(m.email), { method: 'PATCH', body: { role: next } }),
      next === 'owner' ? m.email + ' agora é dono' : m.email + ' agora é membro'
    );
    if (!ok) setRole(m.role);
  }

  async function removeMember(m: TeamMember) {
    const ok = await modal({
      title: 'Tirar ' + m.email + ' da empresa?',
      body: 'A pessoa sai de todos os projetos e os VS Codes dela são desconectados.',
      confirmLabel: 'Tirar da empresa',
      danger: true,
    });
    if (!ok) return;
    if (await run(() => api('/api/team/' + encodeURIComponent(m.email), { method: 'DELETE' }), 'Pessoa removida')) {
      setLeaving((s) => new Set(s).add(m.email));
      setTimeout(() => void run(load), 260);
    }
  }

  const q = query.trim().toLowerCase();
  const list = (data?.members ?? []).filter((m) => !q || m.email.toLowerCase().includes(q));
  const pending = data?.members.filter((m) => m.status === 'pending').length ?? 0;

  return (
    <>
      <section className="page-head">
        <div>
          <h1 className="page-title">Equipe</h1>
          <p className="page-sub">
            Quem é da empresa, em quais projetos trabalha e quem pode administrar. Só quem está num projeto usa a extensão nos repositórios dele.
          </p>
        </div>
        <button id="invite" className="btn-brand" type="button" onClick={invite}>
          Convidar pessoa
        </button>
      </section>

      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" />
          <span className="sr-only">Pesquisar</span>
          <input id="search" type="text" placeholder="Pesquisar por e-mail…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <ul className="team-rows" id="rows">
        {data &&
          list.map((m, i) => {
            const isMe = m.email.toLowerCase() === data.me.toLowerCase();
            return (
              <li key={m.email} className={'team-row enter' + (leaving.has(m.email) ? ' leaving' : '')} style={staggerStyle(i)}>
                <div className="team-who">
                  <span className={'person-avatar' + (m.status === 'active' ? ' active' : '')}>{initial(m.email)}</span>
                  <div className="row-main">
                    <span className="row-title">{m.email + (isMe ? ' (você)' : '')}</span>
                    <span className="row-meta">{m.status === 'pending' ? 'Convite pendente: ainda não entrou' : m.lastLoginAt ? 'Entrou ' + relativeTime(m.lastLoginAt) : 'Ativo'}</span>
                  </div>
                </div>

                {/* Papel: select simples — dono administra projetos/equipe, membro usa. */}
                <select className="role-select" aria-label={'Papel de ' + m.email} value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}>
                  <option value="member">Membro</option>
                  <option value="owner">Dono</option>
                </select>

                <div className="chips">
                  {m.role === 'owner' ? (
                    <span className="chip">Todos os projetos</span>
                  ) : m.projects.length === 0 ? (
                    <span className="chip empty">Nenhum projeto</span>
                  ) : (
                    m.projects.map((name) => (
                      <span key={name} className="chip">
                        {name}
                      </span>
                    ))
                  )}
                </div>

                <div className="member-actions">
                  {!isMe && (
                    <button className="icon-btn danger" type="button" title="Tirar da empresa" aria-label={'Tirar ' + m.email + ' da empresa'} onClick={() => removeMember(m)}>
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
      </ul>
      <p className="page-foot" id="foot">
        {data &&
          `Total de ${data.members.length} ${data.members.length === 1 ? 'pessoa' : 'pessoas'}` + (pending ? `, ${pending} com convite pendente.` : '.')}
      </p>
    </>
  );
}
