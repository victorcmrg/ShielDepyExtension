// Projetos: a tela inicial de todo mundo depois do login.
//   dono   → todos os projetos da empresa, "Novo projeto" e os primeiros passos até a equipe usar
//   membro → só os projetos em que trabalha (é neles que a extensão funciona)
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { initial, relativeTime, staggerStyle } from '../format';
import type { ProjectSummary, Workspace } from '../types';
import { EmptyState } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useUi } from '../ui/UiProvider';

type Filter = 'all' | 'live' | 'norepo';

const FILTERS: [Filter, string][] = [
  ['all', 'Todos'],
  ['live', 'Em uso'],
  ['norepo', 'Sem repositório'],
];

const isLive = (p: ProjectSummary) => p.activeRepos > 0;

export default function Projects() {
  const { modal, run } = useUi();
  const navigate = useNavigate();
  const [data, setData] = useState<Workspace | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    api<Workspace>('/api/workspace').then(setData, () => {});
  }, []);

  async function createProject() {
    const values = await modal({
      title: 'Novo projeto',
      body: 'Depois de criar, conecte os repositórios e escolha quem trabalha nele.',
      confirmLabel: 'Criar projeto',
      fields: [
        { name: 'name', label: 'Nome', placeholder: 'Ex.: Pedidos', required: true },
        { name: 'description', label: 'Descrição (opcional)', placeholder: 'Ex.: Microserviços de pedidos e preço' },
      ],
    });
    if (!values) return;
    let createdId = 0;
    const ok = await run(async () => {
      createdId = (await api<{ id: number }>('/api/projects', { method: 'POST', body: values })).id;
    }, 'Projeto criado');
    if (ok && createdId) navigate('/projects/' + createdId);
  }

  const owner = data?.me.role === 'owner';
  const q = query.trim().toLowerCase();
  const list = (data?.projects ?? []).filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'live' ? isLive(p) : p.repoCount === 0))
  );
  const total = data?.projects.length ?? 0;
  const live = data?.projects.filter(isLive).length ?? 0;

  return (
    <>
      <section className="page-head">
        <div>
          <h1 className="page-title">Projetos</h1>
          <p className="page-sub" id="pageSub">
            {data &&
              (owner
                ? 'Os projetos da empresa. Em cada um você conecta os repositórios e escolhe quem pode usar a ferramenta neles.'
                : 'Os projetos em que você trabalha. A extensão funciona nos repositórios deles.')}
          </p>
        </div>
        <button id="newProject" className="btn-brand" type="button" hidden={!owner} onClick={createProject}>
          Novo projeto
        </button>
      </section>

      <div id="notice">
        {data && !data.me.accessEnabled && (
          <div className="notice-bar">
            <Icon name="lock" />
            <span>O acesso da empresa está suspenso. A extensão fica pausada até o administrador liberar.</span>
          </div>
        )}
      </div>
      <Setup projects={data && owner ? data.projects : null} onCreate={createProject} />

      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" />
          <span className="sr-only">Pesquisar</span>
          <input id="search" type="text" placeholder="Pesquisar em projetos…" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="filter-tabs" id="filter" role="group" aria-label="Filtrar projetos">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="project-grid" id="grid">
        {!data ? (
          <>
            <div className="project-card skeleton" />
            <div className="project-card skeleton" />
            <div className="project-card skeleton" />
          </>
        ) : list.length === 0 ? (
          <ProjectsEmpty filtered={Boolean(q) || filter !== 'all'} owner={owner} onCreate={createProject} />
        ) : (
          list.map((p, i) => <ProjectCard key={p.id} project={p} index={i} />)
        )}
      </div>
      <p className="page-foot" id="foot">
        {total === 0 ? '' : `Total de ${total} ${total === 1 ? 'projeto' : 'projetos'}, ${live} em uso nas últimas 24 horas.`}
      </p>
    </>
  );
}

function StatusBadge({ p }: { p: ProjectSummary }) {
  if (isLive(p)) return <span className="badge badge-live">Em uso</span>;
  if (p.repoCount > 0) return <span className="badge badge-muted">Pronto</span>;
  return <span className="badge badge-warn">Sem repositório</span>;
}

function ProjectCard({ project: p, index }: { project: ProjectSummary; index: number }) {
  return (
    <Link to={'/projects/' + p.id} className="project-card enter" style={staggerStyle(index)}>
      <div className="pc-head">
        <span className="project-tile">{initial(p.name)}</span>
        <div className="pc-title">
          <h3>{p.name}</h3>
          <p>{p.description || 'Sem descrição'}</p>
        </div>
      </div>
      <div className="pc-repo">
        <Icon name="branch" />
        <span>{p.repoCount === 0 ? 'Nenhum repositório conectado' : p.repoCount === 1 ? '1 repositório' : p.repoCount + ' repositórios'}</span>
        {p.lastActivityAt && <em>{'usado ' + relativeTime(p.lastActivityAt)}</em>}
      </div>
      <div className="pc-foot">
        <div className="pc-people">
          <div className="avatar-stack">
            {p.memberPreview.map((email) => (
              <span key={email} title={email}>
                {initial(email)}
              </span>
            ))}
          </div>
          <span>{p.memberCount === 0 ? 'Só o dono' : p.memberCount === 1 ? '1 pessoa' : p.memberCount + ' pessoas'}</span>
        </div>
        <StatusBadge p={p} />
      </div>
    </Link>
  );
}

function ProjectsEmpty({ filtered, owner, onCreate }: { filtered: boolean; owner: boolean; onCreate: () => void }) {
  if (filtered) return <EmptyState style={{ gridColumn: '1 / -1' }} icon="folder" title="Nenhum projeto com esse filtro" text='Limpe a busca ou escolha "Todos".' />;
  if (owner)
    return (
      <EmptyState style={{ gridColumn: '1 / -1' }} icon="folder" title="Nenhum projeto ainda" text="Crie o primeiro projeto e conecte os repositórios da equipe.">
        <button className="btn-brand small" type="button" style={{ marginTop: '10px' }} onClick={onCreate}>
          Novo projeto
        </button>
      </EmptyState>
    );
  return (
    <EmptyState
      style={{ gridColumn: '1 / -1' }}
      icon="folder"
      title="Você ainda não está em nenhum projeto"
      text="Peça ao dono da empresa para te adicionar. Assim que ele fizer isso, o projeto aparece aqui."
    />
  );
}

/**
 * Dono: três passos até a equipe estar usando. Some quando tudo estiver feito. A seção fica sempre no
 * DOM (vazia e com hidden): o CSS dela (display: grid) vence o hidden e o espaçamento da página conta com ela.
 */
function Setup({ projects: ps, onCreate }: { projects: ProjectSummary[] | null; onCreate: () => void }) {
  const navigate = useNavigate();
  const hidden = <section className="setup" id="setup" hidden aria-label="Primeiros passos" />;
  if (!ps) return hidden;
  const steps = [
    { done: ps.length > 0, title: 'Crie um projeto', text: 'Um projeto agrupa os repositórios de um produto e as pessoas que trabalham nele.', action: 'Novo projeto', go: onCreate },
    {
      done: ps.some((p) => p.repoCount > 0),
      title: 'Conecte os repositórios',
      text: 'Cole o remote do .git. A extensão só funciona nos repositórios conectados.',
      action: 'Abrir projeto',
      go: () => ps[0] && navigate('/projects/' + ps[0].id),
    },
    {
      done: ps.some((p) => p.memberCount > 0),
      title: 'Adicione a equipe',
      text: 'Escolha quem pode usar a ferramenta em cada projeto.',
      action: 'Ir para a equipe',
      go: () => navigate('/team'),
    },
  ];
  if (steps.every((s) => s.done)) return hidden;
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="setup" id="setup" aria-label="Primeiros passos">
      {steps.map((s, i) => (
        <div key={s.title} className={'setup-step' + (s.done ? ' done' : i === current ? ' current' : '')}>
          <span className="step-n">{s.done ? <Icon name="check" /> : String(i + 1)}</span>
          <div>
            <strong>{s.title}</strong>
            <p>{s.text}</p>
            {i === current && (
              <button className="text-btn" type="button" onClick={s.go}>
                {s.action}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
