// Uma execução do caos (V3): o status em destaque, de onde ela veio, o escopo do PR e cada rota como
// uma linha do tempo das operações de I/O, com o ponto onde a falha injetada quebrou o código.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { STATUS, failureLabel, FAILURE, formatUsd, opIcon, opVerb, severityTone, shortSha, statusSentence, tagLabel, type Tone } from '../chaos/labels';
import { HistoryStrip, StatusPill } from '../chaos/parts';
import { relativeTime, staggerStyle } from '../format';
import { usePageTitle } from '../layout/Shell';
import type { ChaosOutcome, ChaosResultsView, ChaosRunDetail, SurfaceRoute } from '../types';
import { CountUp, EmptyState } from '../ui/controls';
import { Icon } from '../ui/Icon';

export default function Run() {
  const params = useParams();
  const projectId = Number(params.id);
  const runId = Number(params.runId);
  const navigate = useNavigate();
  const [data, setData] = useState<ChaosRunDetail | null>(null);

  useEffect(() => {
    setData(null);
    api<ChaosRunDetail>(`/api/projects/${projectId}/chaos/runs/${runId}`)
      .then(setData)
      .catch(() => navigate('/projects/' + projectId, { replace: true }));
  }, [projectId, runId, navigate]);

  usePageTitle(data ? `${data.repo?.label ?? 'Execução'} · #${data.run.id}` : null);

  if (!data) return <div className="run-hero skeleton" />;
  const { run, results } = data;
  const tone = STATUS[run.status].tone;

  return (
    <>
      <nav className="crumbs" aria-label="Você está em">
        <Link to="/projects">Projetos</Link>
        <Icon name="chevron" />
        <Link to={'/projects/' + data.project.id}>{data.project.name}</Link>
        <Icon name="chevron" />
        <span className="mono">{data.repo?.label ?? 'repositório removido'}</span>
        <Icon name="chevron" />
        <span>Execução #{run.id}</span>
      </nav>

      <section className={'run-hero enter tone-' + tone}>
        <span className="run-hero-icon">
          <Icon name={STATUS[run.status].icon} />
        </span>
        <div className="run-hero-body">
          <StatusPill status={run.status} large />
          <h1 className="run-title">{statusSentence(run)}</h1>
          <div className="run-meta">
            <span className="meta-chip mono" title={run.commit}>
              <Icon name="commit" />
              {shortSha(run.commit)}
            </span>
            {run.branch && (
              <span className="meta-chip mono">
                <Icon name="branch" />
                {run.branch}
              </span>
            )}
            {run.prUrl ? (
              <a className="meta-chip link" href={run.prUrl} target="_blank" rel="noreferrer">
                <Icon name="external" />
                PR #{run.pr}
              </a>
            ) : (
              run.pr && <span className="meta-chip">PR #{run.pr}</span>
            )}
            {run.runUrl && (
              <a className="meta-chip link" href={run.runUrl} target="_blank" rel="noreferrer">
                <Icon name="external" />
                Job do CI
              </a>
            )}
            <span className="meta-chip">
              <Icon name="clock" />
              {relativeTime(run.createdAt)}
            </span>
            <span className="meta-chip">
              <Icon name="spark" />
              {run.engine === 'offline' ? 'hipóteses do motor' : 'hipóteses com IA (' + run.engine + ')'} · {formatUsd(run.costUsd)}
            </span>
          </div>
          {results.runError && <p className="run-error mono">{results.runError.split('\n')[0]}</p>}
        </div>
      </section>

      <section className="run-metrics" aria-label="Resumo">
        <Metric tone="danger" value={run.failed} label="achados" hint={run.hits === 0 ? 'nenhum no portão' : run.failOn === 'Baixo' ? 'todos contam no portão' : run.hits + ' no portão (' + run.failOn + ' ou pior)'} />
        <Metric tone="ok" value={run.passed} label="aguentaram" hint="o código resistiu à falha" />
        <Metric tone="warn" value={run.invalid} label="inválidos" hint="o controle, sem caos, falhou" />
        <Metric tone="muted" value={run.untested} label="sem teste" hint="hipóteses fora do MVP" />
      </section>

      {results.scope && <ScopeCard scope={results.scope} />}

      <div className="run-section-head">
        <h2>Rotas</h2>
        <p>Cada rota com as operações de I/O na ordem em que acontecem. Onde a falha injetada quebrou o código, a operação fica marcada.</p>
      </div>
      <Routes results={results} />

      {data.history.length > 1 && (
        <section className="pane run-history">
          <div className="pane-head">
            <h2>Histórico de {data.repo?.label}</h2>
            <span className="muted small">{data.history.length} execuções mais recentes</span>
          </div>
          <HistoryStrip projectId={projectId} runs={data.history} current={run.id} />
          <p className="pane-note chaos-legend">
            <span className="legend-dot tone-danger" /> bloqueado <span className="legend-dot tone-warn" /> passou no portão ou erro <span className="legend-dot tone-ok" /> aguentou · a altura é o número de achados
          </p>
        </section>
      )}
    </>
  );
}

function Metric({ tone, value, label, hint }: { tone: Tone; value: number; label: string; hint: string }) {
  return (
    <div className={'run-metric tone-' + tone + (value === 0 ? ' zero' : '')}>
      <CountUp value={value} />
      <span className="run-metric-label">{label}</span>
      <span className="run-metric-hint">{hint}</span>
    </div>
  );
}

function ScopeCard({ scope }: { scope: NonNullable<ChaosResultsView['scope']> }) {
  return (
    <section className="pane scope-card">
      <div className="pane-head">
        <h2>Escopo do PR</h2>
        <span className="muted small mono">desde {scope.base} ({shortSha(scope.commit)})</span>
      </div>
      {scope.all ? (
        <p className="pane-note">Todas as rotas sensíveis entraram: {scope.all}.</p>
      ) : scope.affected.length === 0 ? (
        <p className="pane-note">O PR não tocou nenhuma rota sensível, então nenhum teste precisou rodar.</p>
      ) : (
        <ul className="scope-list">
          {scope.affected.map((a) => (
            <li key={a.id}>
              <code>{a.id}</code>
              <span>{a.why.join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      {scope.untouched.length > 0 && <p className="pane-note scope-untouched">Fora do escopo (o PR não tocou): {scope.untouched.join(', ')}</p>}
    </section>
  );
}

/** As rotas da superfície, as com achado primeiro. Sem superfície (CLI antiga), agrupa pelos resultados. */
function Routes({ results }: { results: ChaosResultsView }) {
  const fromSurface = results.surface?.routes ?? [];
  const known = new Set(fromSurface.map((r) => r.id));
  const extra = [...new Set(results.outcomes.map((o) => o.routeId))].filter((id) => !known.has(id));
  const routes: SurfaceRoute[] = [
    ...fromSurface,
    ...extra.map((id) => ({ id, method: id.split(' ')[0]!, path: id.split(' ').slice(1).join(' '), at: '', handlers: [], operations: [], tags: [], collisions: [], confidence: 'proven' as const })),
  ];
  const weight = (r: SurfaceRoute) => {
    const mine = results.outcomes.filter((o) => o.routeId === r.id);
    return mine.some((o) => o.status === 'failed') ? 0 : mine.length > 0 ? 1 : 2;
  };
  routes.sort((a, b) => weight(a) - weight(b) || a.id.localeCompare(b.id));
  if (routes.length === 0) return <EmptyState icon="grid" title="Nenhuma rota sensível" text="O mapa não achou rota com operação de I/O neste projeto." />;
  return (
    <div className="route-list">
      {routes.map((r, i) => (
        <RouteCard key={r.id} route={r} results={results} index={i} />
      ))}
    </div>
  );
}

function RouteCard({ route, results, index }: { route: SurfaceRoute; results: ChaosResultsView; index: number }) {
  const mine = results.outcomes.filter((o) => o.routeId === route.id);
  const failed = mine.filter((o) => o.status === 'failed');
  const passed = mine.filter((o) => o.status === 'passed');
  const invalid = mine.filter((o) => o.status === 'invalid');
  const untested = results.untested.filter((u) => u.routeId === route.id);
  const outOfScope = results.scope && !results.scope.all && !results.scope.tested.includes(route.id);
  const tone: Tone = failed.length ? (failed.some((o) => o.severity === 'Crítico') ? 'danger' : 'warn') : passed.length ? 'ok' : 'muted';
  const hitsOn = (target: string) => failed.filter((o) => o.target === target);

  return (
    <article className={'route-card enter tone-' + tone + (outOfScope ? ' out-of-scope' : '')} style={staggerStyle(index)}>
      <div className="route-head">
        <span className={'method m-' + route.method.toLowerCase()}>{route.method}</span>
        <code className="route-path">{route.path}</code>
        <span className="route-status">
          {failed.length > 0 ? (
            <span className={'chaos-pill tone-' + tone}>
              <Icon name="alert" />
              {failed.length} achado{failed.length === 1 ? '' : 's'}
            </span>
          ) : passed.length > 0 ? (
            <span className="chaos-pill tone-ok">
              <Icon name="check" />
              aguentou
            </span>
          ) : (
            <span className="chaos-pill tone-muted">{outOfScope ? 'fora do escopo do PR' : 'sem teste'}</span>
          )}
        </span>
      </div>
      {route.tags.length > 0 && (
        <div className="route-tags">
          {route.tags.map((t) => (
            <span key={t.tag} className="tag-chip">
              {tagLabel(t.tag)}
              {t.targets && t.targets.length > 0 && <em>{t.targets.join(', ')}</em>}
            </span>
          ))}
        </div>
      )}

      {route.operations.length > 0 && (
        <ol className="flow" aria-label={'Operações de ' + route.id}>
          <li className="flow-node entry">
            <span className="flow-icon">
              <Icon name="globe" />
            </span>
            <span className="flow-verb">requisição</span>
            <span className="flow-in">{route.handlers.join(' → ') || route.id}</span>
            {route.at && <span className="flow-at mono">{breakable(route.at, '/')}</span>}
          </li>
          {route.operations.map((op) => {
            const hits = hitsOn(op.target);
            const worst = hits.some((h) => h.severity === 'Crítico') ? 'Crítico' : hits[0]?.severity;
            return (
              <li key={op.order} className={'flow-node' + (hits.length ? ' hit tone-' + severityTone(worst) : '')}>
                <span className="flow-icon">
                  <Icon name={opIcon(op)} />
                </span>
                <span className="flow-verb">
                  {opVerb(op)} <b>{op.target}</b>
                </span>
                <span className="flow-in mono">{breakable(op.in, '.')}</span>
                <span className="flow-at mono">{breakable(op.at, '/')}</span>
                <span className="flow-flags">
                  {op.timeout === 'no' && <span className="flag warn">sem timeout</span>}
                  {op.lock && <span className="flag">FOR UPDATE</span>}
                  {op.confidence === 'heuristic' && <span className="flag">por nome</span>}
                </span>
                {hits.length > 0 && (
                  <span className="flow-badge" title={hits.map((h) => failureLabel(h.failure)).join(', ')}>
                    <Icon name="bolt" />
                    {hits.length === 1 ? failureLabel(hits[0]!.failure) : hits.length + ' falhas'}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {failed.length > 0 && (
        <div className="findings">
          {failed.map((o) => (
            <Finding key={o.hypothesisId} outcome={o} />
          ))}
        </div>
      )}

      {(passed.length > 0 || invalid.length > 0 || untested.length > 0) && (
        <div className="route-foot">
          {passed.map((o) => (
            <span key={o.hypothesisId} className="foot-chip tone-ok" title={o.testFile}>
              <Icon name="check" />
              {failureLabel(o.failure)} em {o.target}
            </span>
          ))}
          {invalid.map((o) => (
            <span key={o.hypothesisId} className="foot-chip tone-warn" title={o.message}>
              <Icon name="alert" />
              {failureLabel(o.failure)}: inválido
            </span>
          ))}
          {untested.map((u) => (
            <span key={u.id} className="foot-chip tone-muted" title={u.reason}>
              {failureLabel(u.failure)} em {u.target}: {u.reason}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** Texto longo (função, caminho) que só quebra linha no separador, nunca no meio de um nome. */
function breakable(text: string, sep: string) {
  const parts = text.split(sep);
  return parts.map((p, i) => (
    <span key={i}>
      {p}
      {i < parts.length - 1 && (
        <>
          {sep}
          <wbr />
        </>
      )}
    </span>
  ));
}

function Finding({ outcome: o }: { outcome: ChaosOutcome }) {
  const [invariant, ...rest] = (o.message ?? '').split(': ');
  return (
    <div className={'finding-card tone-' + severityTone(o.severity)}>
      <div className="finding-head">
        <span className="sev-badge">{o.severity}</span>
        <strong>
          {failureLabel(o.failure)} <span className="muted">em</span> <code>{o.target}</code>
        </strong>
      </div>
      <p className="finding-hint">
        {FAILURE[o.failure] ? 'Falha injetada: ' + FAILURE[o.failure]!.hint : 'Falha injetada'} · <span className="finding-time">{(o.durationMs / 1000).toFixed(1).replace('.', ',')} s</span>
      </p>
      {o.message && (
        <p className="finding-invariant">
          <span className="mono">{invariant}</span>
          {rest.length > 0 && <span>{rest.join(': ')}</span>}
        </p>
      )}
      <p className="finding-file mono" title={o.testFile}>
        <Icon name="code" />
        {o.testFile.split('/').pop()}
      </p>
    </div>
  );
}
