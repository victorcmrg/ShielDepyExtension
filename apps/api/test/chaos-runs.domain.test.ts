// O domínio e os casos de uso das execuções do caos, sem banco nem HTTP (decisão 0013).
import { describe, expect, it } from 'vitest';
import { ChaosRunService } from '../src/domains/chaos-runs/application/chaosRuns';
import type { ChaosRunRepository, CiTokenRepository } from '../src/domains/chaos-runs/application/ports';
import type { CiToken } from '../src/domains/chaos-runs/domain/ciToken';
import { MAX_RUNS_PER_REPO, recordOf, runStatus, type RunRecord, type RunSummary } from '../src/domains/chaos-runs/domain/run';
import { parseUpload, UploadError, type ChaosResults } from '../src/domains/chaos-runs/domain/upload';

const results = (extra: Partial<ChaosResults> = {}): ChaosResults => ({ version: 1, ran: true, hits: 0, outcomes: [], untested: [], ...extra });

describe('runStatus: a execução numa palavra', () => {
  it.each<[string, Partial<ChaosResults>, string]>([
    ['erro de ambiente', { runError: 'vitest não rodou' }, 'error'],
    ['o PR não tocou rota sensível', { scope: { tested: [] } }, 'nothing'],
    ['gerou sem rodar', { ran: false }, 'not_run'],
    ['achado no portão', { hits: 1, outcomes: [{ status: 'failed' }] }, 'blocked'],
    ['tudo inválido', { outcomes: [{ status: 'invalid' }, { status: 'invalid' }] }, 'invalid'],
    ['falhou abaixo do portão', { outcomes: [{ status: 'failed' }, { status: 'passed' }] }, 'below_gate'],
    ['passou', { outcomes: [{ status: 'passed' }] }, 'passed'],
  ])('%s → %s', (_label, extra, status) => {
    expect(runStatus(results(extra))).toBe(status);
  });
});

describe('parseUpload', () => {
  const base = { version: 1, remote: 'git@github.com:acme/x.git', commit: 'abc', results: results() };

  it('recusa o que não tem forma de upload', () => {
    expect(() => parseUpload(null)).toThrow(UploadError);
    expect(() => parseUpload({ ...base, version: 2 })).toThrow(UploadError);
    expect(() => parseUpload({ ...base, commit: '' })).toThrow('faltam o remote e o commit');
    expect(() => parseUpload({ ...base, results: { version: 1 } })).toThrow('resultado do caos inválido');
  });

  it('opcional errado sai; link só http(s)', () => {
    const u = parseUpload({ ...base, pr: -3, branch: 7, prUrl: 'javascript:alert(1)', runUrl: 'https://ci/1' });
    expect(u).toEqual({ version: 1, remote: base.remote, commit: 'abc', runUrl: 'https://ci/1', results: base.results });
  });
});

describe('recordOf: a linha do histórico', () => {
  it('conta os resultados e preenche os padrões', () => {
    const upload = parseUpload({ version: 1, remote: 'r', commit: 'c', results: results({ hits: 1, outcomes: [{ status: 'failed' }, { status: 'passed' }, { status: 'invalid' }], untested: [1, 2] }) });
    expect(recordOf(upload, 7)).toEqual({
      createdAt: 7, commit: 'c', branch: null, pr: null, prUrl: null, runUrl: null, status: 'blocked',
      hits: 1, failed: 1, passed: 1, invalid: 1, untested: 2, failOn: '', engine: 'offline', costUsd: 0,
    });
  });
});

/** Repositórios em memória: o caso de uso não sabe que existe SQLite. */
function memory() {
  const runs: (RunSummary & { results: ChaosResults; projectId: number })[] = [];
  const tokens: (CiToken & { projectId: number; hash: string; revoked: boolean })[] = [];
  const runRepo: ChaosRunRepository = {
    insert: (repoId, r: RunRecord, res) => (runs.push({ ...r, id: runs.length + 1, repoId, results: res, projectId: 1 }), runs.length),
    prune: (repoId, keep) => {
      const mine = runs.filter((r) => r.repoId === repoId).sort((a, b) => b.createdAt - a.createdAt);
      for (const old of mine.slice(keep)) runs.splice(runs.indexOf(old), 1);
    },
    history: (repoId, limit) => runs.filter((r) => r.repoId === repoId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit),
    find: (projectId, runId) => {
      const r = runs.find((x) => x.id === runId && x.projectId === projectId);
      return r ? { summary: r, results: r.results } : null;
    },
  };
  const tokenRepo: CiTokenRepository = {
    create: (projectId, hash, label, createdBy, now) => (tokens.push({ id: tokens.length + 1, projectId, hash, label, createdBy, createdAt: now, lastUsedAt: null, revoked: false }), tokens.length),
    listActive: (projectId) => tokens.filter((t) => t.projectId === projectId && !t.revoked),
    revoke: (projectId, id) => {
      const t = tokens.find((x) => x.id === id && x.projectId === projectId && !x.revoked);
      if (t) t.revoked = true;
      return !!t;
    },
    findActive: (hash) => tokens.find((t) => t.hash === hash && !t.revoked) ?? null,
    markUsed: (id, now) => void (tokens.find((t) => t.id === id)!.lastUsedAt = now),
  };
  const service = new ChaosRunService(runRepo, tokenRepo, { repoIdByRemote: (projectId, remote) => (projectId === 1 && remote === 'acme/x' ? 10 : null) }, () => 1000);
  return { service, tokens };
}

describe('ChaosRunService (repositórios em memória)', () => {
  it('token: o valor só sai na criação, o banco guarda o hash; revogado deixa de valer', () => {
    const { service, tokens } = memory();
    const { id, token } = service.createCiToken(1, 'Actions', 'dono@acme.test');
    expect(token.startsWith('sdci_')).toBe(true);
    expect(tokens[0]!.hash).not.toBe(token);
    expect(service.projectForCiToken(token)).toBe(1);
    expect(service.listCiTokens(1)[0]!.lastUsedAt).toBe(1000);
    expect(service.projectForCiToken('outro_formato')).toBeNull();
    expect(service.revokeCiToken(1, id)).toBe(true);
    expect(service.projectForCiToken(token)).toBeNull();
  });

  it('publicar: só em repositório do projeto; grava e respeita a retenção', () => {
    const { service } = memory();
    const upload = { version: 1, remote: 'acme/x', commit: 'c', results: results() };
    expect(service.publish(1, { ...upload, remote: 'acme/outro' })).toEqual({ ok: false, reason: 'repo_not_in_project' });
    expect(() => service.publish(1, { version: 1 })).toThrow(UploadError);
    const published = service.publish(1, upload);
    expect(published.ok).toBe(true);
    for (let i = 0; i < MAX_RUNS_PER_REPO + 5; i++) service.record(10, parseUpload(upload), 2000 + i);
    expect(service.history(10, 500)).toHaveLength(MAX_RUNS_PER_REPO);
  });
});
