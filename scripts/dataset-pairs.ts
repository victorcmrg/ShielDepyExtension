// Os pares para o DPO (D5, decisão 0016) a partir do corpus do `dataset:gerar`. Formato
// provisório `{ id, kind, prompt, chosen, rejected, provenance }`, um por linha.
//
//   npm run dataset:pares -- --in <dataset.jsonl> [--out <pares.jsonl>] [--sem-fracos]
//
// `--sem-fracos` deixa de fora os de diagnóstico ("aguentou" não prova que a rota é segura).

import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '../packages/core/src/index';
import { dpoPairs } from '../packages/agent/src/chaos/dataset-pairs';
import { mergeDatasetJsonl } from '../packages/agent/src/chaos/dataset';
import { arg } from './real-projects';

const input = arg('--in');
if (!input) {
  console.error('uso: npm run dataset:pares -- --in <dataset.jsonl> [--out <pares.jsonl>] [--sem-fracos]');
  process.exit(2);
}
const out = path.resolve(arg('--out') ?? path.join(path.dirname(path.resolve(input)), 'pares.jsonl'));
const { records, skipped } = mergeDatasetJsonl([readFileSync(input, 'utf8')]);
const pairs = dpoPairs(records).filter((p) => !(process.argv.includes('--sem-fracos') && p.provenance.weak));
writeFileSync(out, pairs.map((p) => canonicalJson(p) + '\n').join(''), 'utf8');

const count = (kind: string) => pairs.filter((p) => p.kind === kind).length;
console.log(`${records.length} registro(s) lido(s)${skipped ? ` (${skipped} linha(s) fora do v1)` : ''}`);
console.log(`${pairs.length} par(es) em ${out}: ${count('correção')} de correção, ${count('diagnóstico')} de diagnóstico (fracos)`);
