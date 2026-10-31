// `shieldepy chaos <pasta> --dataset <arq.jsonl>` (D2, decisão 0016): acrescenta ao arquivo um
// registro por hipótese que rodou. Aqui fica o que lê o disco e o git (a fonte, a licença e o
// código da cadeia); o registro em si é a função pura `buildDatasetRecords` do agent. Sem rede:
// o remote vem da config local do git.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { toFileId, type AttackSurface, type CodeGraph, type TopologyGraph } from '@shieldepy/core';
import { buildDatasetRecords, datasetJsonl, routeCode, type ChaosOutcome, type ChaosStateType, type DatasetSource, type DatasetVariant } from '@shieldepy/agent/chaos';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING'];

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** O remote sem usuário e senha (`https://token@github.com/...` não pode ir para o dataset). */
export function publicRemote(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    return u.toString();
  } catch {
    return url; // `git@github.com:dono/repo.git` não é URL; não leva segredo
  }
}

/** O `license` do `package.json` da pasta, senão a primeira linha do `LICENSE`; sobe até a raiz do repositório. */
export function findLicense(dirs: string[]): DatasetSource['license'] {
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { license?: unknown };
      const value = typeof pkg.license === 'string' ? pkg.license : (pkg.license as { type?: unknown } | undefined)?.type;
      if (typeof value === 'string' && value.trim()) return { value: value.trim(), from: 'package.json' };
    } catch {
      // sem package.json legível
    }
    for (const name of LICENSE_FILES) {
      const file = path.join(dir, name);
      if (!existsSync(file)) continue;
      const first = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).find((l) => l.length > 0);
      if (first) return { value: first, from: 'LICENSE' };
    }
  }
  return undefined;
}

/** `-fixed` no nome da pasta é a versão corrigida de um exemplo; o resto é o original (os mutantes saem da D4). */
export function variantOf(project: string): DatasetVariant {
  return project.endsWith('-fixed') ? 'fixed' : 'original';
}

export function datasetSource(root: string): DatasetSource {
  const project = path.basename(root);
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const dirs = [root, ...(top && path.resolve(top) !== path.resolve(root) ? [top] : [])];
  const license = findLicense(dirs);
  return {
    project,
    ...(remote && { repo: publicRemote(remote) }),
    ...(commit && { commit }),
    ...(top && { path: prefix ? prefix.replace(/\/$/, '') : '.' }),
    ...(license && { license }),
    variant: variantOf(project),
  };
}

/** Acrescenta os registros da execução ao JSONL e devolve quantos foram. */
export async function appendChaosDataset(
  file: string,
  run: { root: string; graph: CodeGraph; topology: TopologyGraph; surface: AttackSurface; state: ChaosStateType; outcomes: ChaosOutcome[] }
): Promise<number> {
  const { root, state } = run;
  const code = routeCode(run.topology.routes, run.graph, toFileId(root), (id) => {
    try {
      return readFileSync(id, 'utf8');
    } catch {
      return undefined;
    }
  });
  const records = buildDatasetRecords({
    source: datasetSource(root),
    surface: run.surface,
    code,
    engine: state.engine,
    model: state.completions.find((c) => c.model)?.model,
    hypotheses: state.hypotheses,
    rejected: state.rejected,
    specs: state.specs,
    errors: state.errors,
    files: state.files,
    outcomes: run.outcomes,
  });
  if (records.length === 0) return 0;
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await appendFile(file, datasetJsonl(records), 'utf8');
  return records.length;
}
