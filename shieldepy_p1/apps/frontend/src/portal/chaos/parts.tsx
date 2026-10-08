// Peças do caos que a página do projeto e a da execução usam juntas.
import { Link } from 'react-router-dom';
import { relativeTime } from '../format';
import type { RunStatus, RunSummary } from '../types';
import { Icon } from '../ui/Icon';
import { STATUS } from './labels';

export function StatusPill({ status, large }: { status: RunStatus; large?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={'chaos-pill tone-' + s.tone + (large ? ' large' : '')}>
      <Icon name={s.icon} />
      {s.label}
    </span>
  );
}

/**
 * As últimas execuções de um repositório, a mais recente à direita: a altura diz quantos achados,
 * a cor diz o status. Cada barra leva à execução.
 */
export function HistoryStrip({ projectId, runs, current }: { projectId: number; runs: RunSummary[]; current?: number }) {
  const ordered = [...runs].reverse();
  const most = Math.max(1, ...ordered.map((r) => r.failed));
  return (
    <div className="chaos-strip" role="list" aria-label="Últimas execuções">
      {ordered.map((r) => (
        <Link
          key={r.id}
          role="listitem"
          to={`/projects/${projectId}/runs/${r.id}`}
          className={'chaos-bar tone-' + STATUS[r.status].tone + (r.id === current ? ' current' : '')}
          title={`${STATUS[r.status].label} · ${r.failed} achado(s) · ${relativeTime(r.createdAt)}${r.pr ? ' · PR #' + r.pr : r.branch ? ' · ' + r.branch : ''}`}
          // altura mínima para as verdes também aparecerem; o resto cresce com os achados
          style={{ '--h': String(0.28 + 0.72 * (r.failed / most)) } as React.CSSProperties}
        >
          <span />
        </Link>
      ))}
    </div>
  );
}
