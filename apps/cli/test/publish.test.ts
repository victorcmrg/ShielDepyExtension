import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ciContext, runPublishCommand, type Fetcher } from '../src/publish';

const RESULTS = { version: 1, project: 'checkout', topologyHash: 'h'.repeat(64), engine: 'offline', ran: true, failOn: 'Alto', hits: 1, outcomes: [], untested: [], cost: { calls: 0 } };

describe('V3a — shieldepy publish', () => {
  let dir: string;
  let commit: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-publish-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '--quiet', '-b', 'main');
    git('remote', 'add', 'origin', 'git@github.com:Acme/Checkout.git');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'x');
    commit = git('rev-parse', 'HEAD');
    fs.mkdirSync(path.join(dir, '.shieldepy'));
    fs.writeFileSync(path.join(dir, '.shieldepy', 'chaos-results.json'), JSON.stringify(RESULTS));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const io = (env: NodeJS.ProcessEnv) => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env }, out, err };
  };

  it('manda o resultado com o remote, o commit, a branch, o PR e o link do job; e põe o link no relatório', async () => {
    const report = path.join(dir, 'chaos-report.md');
    fs.writeFileSync(report, '<!-- shieldepy-chaos -->\n## relatório\n');
    const calls: { url: string; init: Parameters<Fetcher>[1] }[] = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ url: 'https://portal.test/projects/1/runs/7' }) };
    };
    const env = {
      SHIELDEPY_PORTAL_TOKEN: 'sdci_abc',
      GITHUB_REPOSITORY: 'acme/checkout',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REF: 'refs/pull/42/merge',
      GITHUB_HEAD_REF: 'feat/x',
      GITHUB_RUN_ID: '999',
    };
    const t = io(env);
    expect(await runPublishCommand({ target: dir, portal: 'https://portal.test/', appendLink: report }, t.io, fetcher)).toBe(0);
    expect(calls[0]!.url).toBe('https://portal.test/api/ci/chaos-runs');
    expect(calls[0]!.init.headers.authorization).toBe('Bearer sdci_abc');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      version: 1,
      remote: 'git@github.com:Acme/Checkout.git',
      commit,
      branch: 'feat/x',
      pr: 42,
      prUrl: 'https://github.com/acme/checkout/pull/42',
      runUrl: 'https://github.com/acme/checkout/actions/runs/999',
      results: RESULTS,
    });
    expect(t.out.join('\n')).toContain('publicado no portal: https://portal.test/projects/1/runs/7');
    expect(fs.readFileSync(report, 'utf8')).toContain('[Ver esta execução no portal do ShielDepy](https://portal.test/projects/1/runs/7)');
  });

  it('sem token, sem portal, sem resultado, ou recusado pelo portal: exit 2 com o motivo (no CI o passo é separado do portão)', async () => {
    const noToken = io({});
    expect(await runPublishCommand({ target: dir, portal: 'https://p.test' }, noToken.io)).toBe(2);
    expect(noToken.err.join()).toMatch(/SHIELDEPY_PORTAL_TOKEN/);

    const noPortal = io({ SHIELDEPY_PORTAL_TOKEN: 'x' });
    expect(await runPublishCommand({ target: dir }, noPortal.io)).toBe(2);

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-empty-'));
    const noResults = io({ SHIELDEPY_PORTAL_TOKEN: 'x' });
    expect(await runPublishCommand({ target: empty, portal: 'https://p.test' }, noResults.io)).toBe(2);
    expect(noResults.err.join()).toMatch(/Rode o shieldepy chaos/);
    fs.rmSync(empty, { recursive: true, force: true });

    const refused = io({ SHIELDEPY_PORTAL_TOKEN: 'x' });
    const forbidden: Fetcher = async () => ({ ok: false, status: 403, json: async () => ({ error: 'este repositório não está no projeto do token' }) });
    expect(await runPublishCommand({ target: dir, portal: 'https://p.test' }, refused.io, forbidden)).toBe(2);
    expect(refused.err.join()).toContain('(403): este repositório não está no projeto do token');

    const down = io({ SHIELDEPY_PORTAL_TOKEN: 'x' });
    expect(await runPublishCommand({ target: dir, portal: 'https://p.test' }, down.io, async () => { throw new Error('ECONNREFUSED'); })).toBe(2);
    expect(down.err.join()).toContain('ECONNREFUSED');
  });

  it('fora do GitHub Actions, o contexto do CI fica vazio; em push, a branch vem do GITHUB_REF_NAME e não há PR', () => {
    expect(ciContext({})).toEqual({});
    expect(ciContext({ GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'a/b', GITHUB_RUN_ID: '1' })).toEqual({ branch: 'main', runUrl: 'https://github.com/a/b/actions/runs/1' });
  });
});
