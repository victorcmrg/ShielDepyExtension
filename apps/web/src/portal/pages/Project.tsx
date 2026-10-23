// Página de um projeto: repositórios (com o uso que a extensão registra a partir do .git),
// pessoas e o passo a passo. O dono edita tudo; o membro só consulta.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { formatDate, initial, relativeTime, staggerStyle } from '../format';
import { usePageTitle } from '../layout/Shell';
import type { ProjectDetail, ProjectMember, Repo } from '../types';
import { CountUp, EmptyState } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useUi } from '../ui/UiProvider';
import { ChaosOverview, CiTokensPane } from '../chaos/ProjectChaos';

const LIVE_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const short = (email: string) => email.split('@')[0];

export default function Project() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { modal, run } = useUi();
  const [data, setData] = useState<ProjectDetail | null>(null);
  // linhas saindo (animação de remoção) até a lista voltar do servidor
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setData(await api<ProjectDetail>('/api/projects/' + id));
    setLeaving(new Set());
  }, [id]);

  useEffect(() => {
    setData(null);
    load().catch(() => navigate('/projects', { replace: true }));
  }, [load, navigate]);

  usePageTitle(data ? data.project.name : null);

  /** Remove uma linha: ação na API, animação de saída e recarrega. */
  async function removeRow(key: string, action: () => Promise<unknown>) {
    if (!(await run(action))) return;
    setLeaving((s) => new Set(s).add(key));
    setTimeout(() => void run(load), 260);
  }

  async function addRepo() {
    const values = await modal({
      title: 'Conectar repositório',
      body: 'Quem estiver neste projeto passa a usar a extensão nesse repositório.',
      confirmLabel: 'Conectar',
      fields: [
        {
          name: 'url',
          label: 'Remote do repositório',
          placeholder: 'https://github.com/empresa/repositorio.git',
          required: true,
          hint: 'No terminal, dentro do repositório: git remote get-url origin. Serve https ou ssh.',
        },
      ],
    });
    if (values && (await run(() => api('/api/projects/' + id + '/repos', { method: 'POST', body: values }), 'Repositório conectado'))) void run(load);
  }

  async function addPerson() {
    if (!data) return;
    if (data.candidates.length === 0) {
      const go = await modal({
        title: 'Todos da equipe já estão aqui',
        body: 'Para trazer alguém novo, convide a pessoa em Equipe e depois adicione ao projeto.',
        confirmLabel: 'Ir para Equipe',
      });
      if (go) navigate('/team');
      return;
    }
    const values = await modal({
      title: 'Adicionar ao projeto',
      confirmLabel: 'Adicionar',
      fields: [{ name: 'emails', label: 'Pessoas da equipe', type: 'checkboxes', options: data.candidates.map((e) => ({ value: e, label: e })) }],
    });
    const emails = (values?.emails ?? []) as string[];
    if (emails.length === 0) return;
    const ok = await run(async () => {
      for (const email of emails) await api('/api/projects/' + id + '/members', { method: 'POST', body: { email } });
    }, emails.length === 1 ? 'Pessoa adicionada' : 'Pessoas adicionadas');
    if (ok) void run(load);
  }

  async function edit() {
    if (!data) return;
    const values = await modal({
      title: 'Editar projeto',
      confirmLabel: 'Salvar',
      fields: [
        { name: 'name', label: 'Nome', value: data.project.name, required: true },
        { name: 'description', label: 'Descrição', value: data.project.description },
      ],
    });
    if (values && (await run(() => api('/api/projects/' + id, { method: 'PATCH', body: values }), 'Projeto atualizado'))) void run(load);
  }

  async function remove() {
    if (!data) return;
    const ok = await modal({
      title: 'Excluir ' + data.project.name + '?',
      body: 'Os repositórios deixam de estar liberados e as pessoas saem do projeto. Isso não mexe no código.',
      confirmLabel: 'Excluir projeto',
      danger: true,
    });
    if (ok && (await run(() => api('/api/projects/' + id, { method: 'DELETE' }), 'Projeto excluído'))) navigate('/projects');
  }

  const p = data?.project;
  const canManage = Boolean(data?.canManage);

  return (
    <>
      <nav className="crumbs" aria-label="Você está em">
        <Link to="/projects">Projetos</Link>
        <span id="crumbSep">
          <Icon name="chevron" />
        </span>
        <span id="crumbName">{p?.name}</span>
      </nav>

      <section className="page-head">
        <div className="project-hero">
          <span className="project-tile large" id="tile">
            {p && initial(p.name)}
          </span>
          <div>
            <h1 className="page-title" id="name">
              {p?.name}
            </h1>
            <p className="page-sub" id="description">
              {p && (p.description || (canManage ? 'Sem descrição.' : ''))}
            </p>
          </div>
        </div>
        <div className="head-actions" id="headActions" hidden={!canManage}>
          <button id="editBtn" className="btn-ghost small" type="button" onClick={edit}>
            Editar
          </button>
          <button id="deleteBtn" className="text-btn danger" type="button" onClick={remove}>
            Excluir projeto
          </button>
        </div>
      </section>

      <section className="metrics" aria-label="Resumo">
        <div className="metric">
          <CountUp id="mRepos" value={data?.repos.length ?? 0} />
          <span>Repositórios conectados</span>
        </div>
        <div className="metric">
          <CountUp id="mPeople" value={data?.members.length ?? 0} />
          <span>Pessoas no projeto</span>
        </div>
        <div className="metric">
          <CountUp id="mLive" value={data?.repos.filter((r) => r.lastSeen && Date.now() - r.lastSeen.at < DAY_MS).length ?? 0} />
          <span>Em uso nas últimas 24 horas</span>
        </div>
      </section>

      <div className="detail-grid">
        <div>
          {data && <ChaosOverview projectId={id} />}

          <section className="pane" aria-labelledby="reposTitle">
            <div className="pane-head">
              <h2 id="reposTitle">Repositórios</h2>
              <button id="addRepo" className="btn-brand small" type="button" hidden={!canManage} onClick={addRepo}>
                Conectar repositório
              </button>
            </div>
            <p className="pane-note">
              A extensão lê o <code>.git</code> do repositório aberto no VS Code e só liga se ele estiver aqui.
            </p>
            <ul className="row-list" id="repos">
              {data &&
                (data.repos.length === 0 ? (
                  <EmptyState
                    as="li"
                    compact
                    icon="branch"
                    title="Nenhum repositório conectado"
                    text={canManage ? 'Conecte o primeiro: cole o remote do .git (git remote get-url origin).' : 'O dono da empresa ainda não conectou os repositórios deste projeto.'}
                  />
                ) : (
                  data.repos.map((repo, i) => (
                    <RepoRow
                      key={repo.id}
                      repo={repo}
                      index={i}
                      leaving={leaving.has('repo:' + repo.id)}
                      onRemove={
                        canManage
                          ? async () => {
                              const ok = await modal({
                                title: 'Desconectar ' + repo.label + '?',
                                body: 'A extensão deixa de funcionar nesse repositório para todos deste projeto.',
                                confirmLabel: 'Desconectar',
                                danger: true,
                              });
                              if (ok) await removeRow('repo:' + repo.id, () => api('/api/projects/' + id + '/repos/' + repo.id, { method: 'DELETE' }));
                            }
                          : undefined
                      }
                    />
                  ))
                ))}
            </ul>
          </section>

          <section className="pane" aria-labelledby="howTitle">
            <div className="pane-head">
              <h2 id="howTitle">Como usar neste projeto</h2>
            </div>
            <ol className="steps">
              <li>
                <span className="step-n">1</span>
                <div>
                  <strong>Instale a extensão ShielDepy no VS Code</strong>
                  <p>Ela aparece na barra lateral com o escudo verde.</p>
                </div>
              </li>
              <li>
                <span className="step-n">2</span>
                <div>
                  <strong>Entre com a sua conta</strong>
                  <p>Clique em "Entrar" na extensão e confirme no navegador.</p>
                </div>
              </li>
              <li>
                <span className="step-n">3</span>
                <div>
                  <strong>Abra um dos repositórios acima</strong>
                  <p>
                    A extensão confere o remote do <code>.git</code> e libera sozinha. O uso aparece aqui na hora.
                  </p>
                </div>
              </li>
            </ol>
          </section>
        </div>

        <div>
          <section className="pane" aria-labelledby="peopleTitle">
            <div className="pane-head">
              <h2 id="peopleTitle">Pessoas</h2>
              <button id="addPerson" className="btn-ghost small" type="button" hidden={!canManage} onClick={addPerson}>
                Adicionar
              </button>
            </div>
            <p className="pane-note" id="peopleNote">
              {data &&
                (canManage
                  ? 'Quem está aqui pode usar a extensão nos repositórios deste projeto. Você, como dono, já tem acesso a todos.'
                  : 'Quem trabalha neste projeto com você.')}
            </p>
            <ul className="row-list" id="people">
              {data &&
                (data.members.length === 0 ? (
                  <EmptyState as="li" compact icon="users" title="Ninguém além do dono" text={canManage ? 'Adicione as pessoas que vão trabalhar aqui.' : ''} />
                ) : (
                  data.members.map((m, i) => (
                    <PersonRow
                      key={m.email}
                      member={m}
                      index={i}
                      leaving={leaving.has('member:' + m.email)}
                      onRemove={
                        canManage
                          ? () => removeRow('member:' + m.email, () => api('/api/projects/' + id + '/members/' + encodeURIComponent(m.email), { method: 'DELETE' }))
                          : undefined
                      }
                    />
                  ))
                ))}
            </ul>
          </section>
          {canManage && <CiTokensPane projectId={id} />}
        </div>
      </div>
    </>
  );
}

/** Linha de status do repositório, a partir do último uso registrado pela extensão. */
function RepoStatus({ repo }: { repo: Repo }) {
  const seen = repo.lastSeen;
  const age = seen ? Date.now() - seen.at : Infinity;
  let text: string;
  if (!seen) text = 'Ainda não foi aberto com a extensão';
  else {
    const who = short(seen.email) + (seen.branch ? ' na ' + seen.branch : '');
    text = age < LIVE_MS ? 'Em uso agora por ' + who : 'Usado ' + relativeTime(seen.at) + ' por ' + who;
    if (repo.usersLast24h > 1) text += ' (' + repo.usersLast24h + ' pessoas hoje)';
  }
  return (
    <span className="row-meta">
      <span className={'live-dot ' + (age < LIVE_MS ? 'live' : age < DAY_MS ? 'recent' : 'idle')} />
      <span>{text}</span>
    </span>
  );
}

function RepoRow({ repo, index, leaving, onRemove }: { repo: Repo; index: number; leaving: boolean; onRemove?: () => void }) {
  return (
    <li className={'row-item enter' + (leaving ? ' leaving' : '')} style={staggerStyle(index)}>
      <span className="row-icon">
        <Icon name="repo" />
      </span>
      <div className="row-main">
        <span className="row-title mono" title={repo.remote}>
          {repo.label}
        </span>
        <RepoStatus repo={repo} />
      </div>
      {onRemove && (
        <button className="icon-btn danger" type="button" aria-label={'Desconectar ' + repo.label} title="Desconectar" onClick={onRemove}>
          <Icon name="trash" />
        </button>
      )}
    </li>
  );
}

function PersonRow({ member: m, index, leaving, onRemove }: { member: ProjectMember; index: number; leaving: boolean; onRemove?: () => void }) {
  return (
    <li className={'row-item enter' + (leaving ? ' leaving' : '')} style={staggerStyle(index)}>
      <span className={'person-avatar' + (m.status === 'active' ? ' active' : '')}>{initial(m.email)}</span>
      <div className="row-main">
        <span className="row-title">{m.email}</span>
        <span className="row-meta">
          {m.status === 'pending' ? 'Convite pendente: ainda não entrou' : m.lastLoginAt ? 'Entrou ' + relativeTime(m.lastLoginAt) : 'No projeto desde ' + formatDate(m.addedAt)}
        </span>
      </div>
      {onRemove && (
        <button className="icon-btn danger" type="button" aria-label={'Tirar ' + m.email + ' do projeto'} title="Tirar do projeto" onClick={onRemove}>
          <Icon name="x" />
        </button>
      )}
    </li>
  );
}
