// `shieldepy publish <pasta> --portal <url>` (V3): manda o resultado do último `shieldepy chaos`
// (`.shieldepy/chaos-results.json`) para o portal, com o commit, a branch, o PR e o link do job.
// O token do projeto vem de SHIELDEPY_PORTAL_TOKEN. No CI, este passo é separado do portão: falhar
// aqui (exit 2) nunca muda o resultado do caos.

import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { repoInfo } from '@shieldepy/core';
import { CHAOS_RESULTS_FILE, type ChaosResults, type ChaosRunUpload } from '@shieldepy/agent/chaos';

interface PublishIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

export interface PublishArgs {
  target: string;
  portal?: string;
  /** Acrescenta o link da execução no portal a este relatório markdown (o do comentário do PR). */
  appendLink?: string;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** O que o GitHub Actions diz sobre a execução (PR, branch, link do job). Fora dele, nada. */
export function ciContext(env: NodeJS.ProcessEnv): { branch?: string; pr?: number; prUrl?: string; runUrl?: string } {
  const repo = env.GITHUB_REPOSITORY;
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const prMatch = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');
  const pr = prMatch ? Number(prMatch[1]) : undefined;
  return {
    ...((env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME) && { branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME }),
    ...(pr && { pr }),
    ...(pr && repo && { prUrl: `${server}/${repo}/pull/${pr}` }),
    ...(repo && env.GITHUB_RUN_ID && { runUrl: `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` }),
  };
}

export async function runPublishCommand(args: PublishArgs, io: PublishIo, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<number> {
  const portal = (args.portal ?? io.env.SHIELDEPY_PORTAL_URL ?? '').replace(/\/+$/, '');
  const token = io.env.SHIELDEPY_PORTAL_TOKEN;
  if (!portal) {
    io.err('erro: informe o portal: --portal https://… (ou SHIELDEPY_PORTAL_URL).');
    return 2;
  }
  if (!token) {
    io.err('erro: falta SHIELDEPY_PORTAL_TOKEN (crie um token de CI na página do projeto, no portal).');
    return 2;
  }
  const root = path.resolve(args.target);
  const file = path.join(root, CHAOS_RESULTS_FILE);
  if (!existsSync(file)) {
    io.err(`erro: falta ${CHAOS_RESULTS_FILE}. Rode o shieldepy chaos antes de publicar.`);
    return 2;
  }
  const results = JSON.parse(await readFile(file, 'utf8')) as ChaosResults;
  const git = await repoInfo(root);
  const ci = ciContext(io.env);
  if (!git.remote || !git.commit) {
    io.err('erro: não deu para ler o remote "origin" e o commit pelo git. O portal identifica o repositório pelo remote.');
    return 2;
  }
  const upload: ChaosRunUpload = {
    version: 1,
    remote: git.remote,
    commit: io.env.SHIELDEPY_COMMIT || git.commit,
    ...((ci.branch || git.branch) && { branch: ci.branch || git.branch }),
    ...(ci.pr && { pr: ci.pr }),
    ...(ci.prUrl && { prUrl: ci.prUrl }),
    ...(ci.runUrl && { runUrl: ci.runUrl }),
    results,
  };

  let res;
  try {
    res = await fetcher(`${portal}/api/ci/chaos-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(upload),
    });
  } catch (err) {
    io.err(`erro: o portal não respondeu (${err instanceof Error ? err.message : err}).`);
    return 2;
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    io.err(`erro: o portal recusou a publicação (${res.status}): ${data.error ?? 'sem detalhe'}`);
    return 2;
  }
  io.out(`✓ publicado no portal: ${data.url}`);
  if (args.appendLink) await appendFile(args.appendLink, `\n[Ver esta execução no portal do ShielDepy](${data.url})\n`, 'utf8');
  return 0;
}
