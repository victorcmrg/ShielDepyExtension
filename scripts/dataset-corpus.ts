// O corpus de treino a partir das partes (uma por projeto ou mutante, em <dir>/partes/): junta por
// id e imprime o resumo. Usado pelo `dataset:gerar` (D3) e pelo `dataset:mutantes` (D4).

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetJsonl, mergeDatasetJsonl } from '../packages/agent/src/chaos/dataset';
import { envWithoutDatasetDb } from '../apps/cli/src/dataset';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js');

/** Um `chaos --offline --dataset` sem a variável do banco: quem envia é o `dataset:enviar`, com o corpus pronto. */
export function runChaosChild(dir: string, file: string, args: string[] = [], cli: string = CLI): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cli, 'chaos', dir, '--offline', ...args, '--dataset', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: envWithoutDatasetDb(process.env) });
}

export function writeCorpus(parts: string, out: string): void {
  const texts = readdirSync(parts)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => readFileSync(path.join(parts, f), 'utf8'));
  const { records, duplicates, skipped } = mergeDatasetJsonl(texts);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, datasetJsonl(records), 'utf8');

  const rows = new Map<string, { achado: number; aguentou: number; inválido: number; license: string }>();
  for (const r of records) {
    const key = `${r.source.project} | ${r.source.variant.startsWith('mutante:') ? 'mutantes' : r.source.variant}`;
    const row = rows.get(key) ?? { achado: 0, aguentou: 0, inválido: 0, license: r.source.license?.value ?? '—' };
    row[r.result.outcome]++;
    rows.set(key, row);
  }
  console.log('\n| Projeto | Variante | Licença | Achados | Aguentou | Inválidos |');
  console.log('|---|---|---|---|---|---|');
  for (const [key, r] of rows) console.log(`| ${key} | ${r.license} | ${r.achado} | ${r.aguentou} | ${r.inválido} |`);
  console.log(`\n${records.length} registro(s) em ${out}${duplicates ? ` (${duplicates} repetido(s) por id, fica o último)` : ''}${skipped ? `; ${skipped} linha(s) fora do formato v1 ignorada(s)` : ''}`);
}
