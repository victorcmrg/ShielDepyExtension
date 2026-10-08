// Página do projeto (V3): o caos no CI de cada repositório e, para o dono, os tokens do CI.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { relativeTime, staggerStyle } from '../format';
import type { CiToken, ProjectChaos } from '../types';
import { EmptyState } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useUi } from '../ui/UiProvider';
import { shortSha } from './labels';
import { HistoryStrip, StatusPill } from './parts';

/** Cartão por repositório: o status da última execução, de onde ela veio, as contagens e o histórico. */
export function ChaosOverview({ projectId }: { projectId: number }) {
  const [data, setData] = useState<ProjectChaos | null>(null);
  useEffect(() => {
    setData(null);
    api<ProjectChaos>('/api/projects/' + projectId + '/chaos')
      .then(setData)
      .catch(() => setData({ repos: [], canManage: false }));
  }, [projectId]);

  const withRuns = data?.repos.filter((r) => r.latest) ?? [];
  return (
    <section className="pane chaos-pane" aria-labelledby="chaosTitle">
      <div className="pane-head">
        <h2 id="chaosTitle">
          <span className="chaos-title-icon">
            <Icon name="bolt" />
          </span>
          Caos no CI
        </h2>
      </div>
      <p className="pane-note">
        A cada PR, o ShielDepy injeta falhas reais (corrida, API lenta, resposta inválida) só nas rotas que o PR tocou, e barra o merge quando o código quebra.
      </p>
      {!data ? (
        <div className="chaos-card skeleton" />
      ) : withRuns.length === 0 ? (
        <EmptyState compact icon="bolt" title="Nenhuma execução publicada ainda" text="Crie um token de CI aqui e adicione o passo de publicar ao workflow: o resultado de cada PR aparece neste painel." />
      ) : (
        <div className="chaos-cards">
          {withRuns.map(({ repo, latest, history }, i) => {
            const run = latest!;
            return (
              // o cartão inteiro leva à execução pelo link esticado (CSS); a faixa de histórico fica por cima
              <div key={repo.id} className={'chaos-card enter tone-edge-' + run.status} style={staggerStyle(i)}>
                <div className="chaos-card-head">
                  <span className="chaos-card-repo">
                    <Icon name="repo" />
                    <span>{repo.label}</span>
                  </span>
                  <StatusPill status={run.status} />
                </div>
                <div className="chaos-card-meta">
                  <span>{relativeTime(run.createdAt)}</span>
                  {run.pr ? <span>PR #{run.pr}</span> : run.branch && <span className="mono">{run.branch}</span>}
                  <span className="mono">{shortSha(run.commit)}</span>
                </div>
                <div className="chaos-card-counts">
                  <span className={run.failed ? 'count tone-danger' : 'count'}>
                    <strong>{run.failed}</strong> achado{run.failed === 1 ? '' : 's'}
                  </span>
                  <span className="count tone-ok">
                    <strong>{run.passed}</strong> aguentou
                  </span>
                  {run.invalid > 0 && (
                    <span className="count tone-warn">
                      <strong>{run.invalid}</strong> inválido{run.invalid === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="chaos-card-foot">
                  <HistoryStrip projectId={projectId} runs={history} current={run.id} />
                  <Link className="chaos-card-cta" to={`/projects/${projectId}/runs/${run.id}`}>
                    Ver execução <Icon name="arrow" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Tokens do CI (só o dono): criar, ver uma vez, copiar e revogar; e o passo a passo do workflow. */
export function CiTokensPane({ projectId }: { projectId: number }) {
  const { modal, run } = useUi();
  const [tokens, setTokens] = useState<CiToken[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setTokens((await api<{ tokens: CiToken[] }>('/api/projects/' + projectId + '/ci-tokens')).tokens);
  }, [projectId]);
  useEffect(() => {
    load().catch(() => setTokens([]));
  }, [load]);

  async function create() {
    const values = await modal({
      title: 'Novo token de CI',
      body: 'O token deixa o CI publicar os resultados do caos nos repositórios deste projeto. Ele aparece uma vez só.',
      confirmLabel: 'Criar token',
      fields: [{ name: 'label', label: 'Nome', value: 'GitHub Actions', required: true }],
    });
    if (!values) return;
    let created: { token: string } | undefined;
    const ok = await run(async () => {
      created = await api<{ id: number; token: string }>('/api/projects/' + projectId + '/ci-tokens', { method: 'POST', body: values });
    }, 'Token criado');
    if (ok && created) {
      setFresh(created.token);
      setCopied(false);
      void run(load);
    }
  }

  async function revoke(t: CiToken) {
    const ok = await modal({
      title: 'Revogar ' + t.label + '?',
      body: 'O CI que usa este token deixa de publicar na hora. Os resultados já publicados continuam aqui.',
      confirmLabel: 'Revogar',
      danger: true,
    });
    if (ok && (await run(() => api('/api/projects/' + projectId + '/ci-tokens/' + t.id, { method: 'DELETE' }), 'Token revogado'))) void run(load);
  }

  async function copy() {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh).catch(() => {});
    setCopied(true);
  }

  return (
    <section className="pane" aria-labelledby="ciTitle">
      <div className="pane-head">
        <h2 id="ciTitle">Integração com o CI</h2>
        <button className="btn-ghost small" type="button" onClick={create}>
          Criar token
        </button>
      </div>
      <p className="pane-note">
        No GitHub, guarde o token como o secret <code>SHIELDEPY_PORTAL_TOKEN</code> e o endereço deste portal como a variável <code>SHIELDEPY_PORTAL_URL</code>.
      </p>

      {fresh && (
        <div className="token-reveal enter">
          <div className="token-reveal-head">
            <Icon name="key" />
            <strong>Copie agora: este token não aparece de novo</strong>
          </div>
          <div className="token-box">
            <code>{fresh}</code>
            <button className="icon-btn" type="button" aria-label="Copiar token" title={copied ? 'Copiado' : 'Copiar'} onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} />
            </button>
          </div>
          <button className="text-btn" type="button" onClick={() => setFresh(null)}>
            Já guardei
          </button>
        </div>
      )}

      <ul className="row-list">
        {tokens &&
          (tokens.length === 0 ? (
            <EmptyState as="li" compact icon="key" title="Nenhum token ainda" text="Crie um para o CI publicar os resultados aqui." />
          ) : (
            tokens.map((t, i) => (
              <li key={t.id} className="row-item enter" style={staggerStyle(i)}>
                <span className="row-icon">
                  <Icon name="key" />
                </span>
                <div className="row-main">
                  <span className="row-title">{t.label}</span>
                  <span className="row-meta">
                    <span className={'live-dot ' + (t.lastUsedAt ? 'recent' : 'idle')} />
                    <span>{t.lastUsedAt ? 'Publicou ' + relativeTime(t.lastUsedAt) : 'Ainda não publicou'} · criado por {t.createdBy}</span>
                  </span>
                </div>
                <button className="icon-btn danger" type="button" aria-label={'Revogar ' + t.label} title="Revogar" onClick={() => revoke(t)}>
                  <Icon name="trash" />
                </button>
              </li>
            ))
          ))}
      </ul>
    </section>
  );
}

