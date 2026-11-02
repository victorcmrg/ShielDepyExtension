// Os pares para o DPO (D5, decisões 0016 e 0021), no formato que a equipe de treino aprovou:
// `{ id, kind, prompt, chosen, rejected, provenance }`.
//
//   npm run dataset:pares                     → lê os registros do banco do treino e grava os pares lá
//   npm run dataset:pares -- --in <arq.jsonl> → lê de um arquivo (e grava no banco, se houver a variável)
//   npm run dataset:pares -- --out <arq.jsonl> → também grava os pares num arquivo
//
// O banco é o da variável SHIELDEPY_DATASET_DATABASE_URL (0020). `--sem-fracos` deixa de fora os de
// diagnóstico ("aguentou" não prova que a rota é segura).

import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '../packages/core/src/index';
import { dpoPairs } from '../packages/agent/src/chaos/dataset-pairs';
import { mergeDatasetJsonl, uniqueDatasetRecords } from '../packages/agent/src/chaos/dataset';
import { DATASET_DB_ENV, dbHost, DPO_TABLE, publishDpoPairs, readDatasetRecords } from '../apps/cli/src/dataset';
import { arg } from './real-projects';

const input = arg('--in');
const url = process.env[DATASET_DB_ENV]?.trim() || undefined;
if (!input && !url) {
  console.error(`uso: npm run dataset:pares -- [--in <dataset.jsonl>] [--out <pares.jsonl>] [--sem-fracos]\nSem --in, os registros vêm do banco da variável ${DATASET_DB_ENV}.`);
  process.exit(2);
}
const read = input ? mergeDatasetJsonl([readFileSync(input, 'utf8')]).records : await readDatasetRecords(url!);
const records = uniqueDatasetRecords(read);
const pairs = dpoPairs(records).filter((p) => !(process.argv.includes('--sem-fracos') && p.provenance.weak));
const count = (kind: string) => pairs.filter((p) => p.kind === kind).length;
console.log(`${read.length} registro(s) lido(s), ${records.length} sem repetir; ${pairs.length} par(es): ${count('correcao')} de correção, ${count('diagnostico')} de diagnóstico (fracos)`);

const out = arg('--out');
if (out) {
  writeFileSync(path.resolve(out), pairs.map((p) => canonicalJson(p) + '\n').join(''), 'utf8');
  console.log(`✓ gravados em ${out}`);
}
if (url) console.log(`✓ ${await publishDpoPairs(pairs, url)} par(es) em ${dbHost(url)} (tabela ${DPO_TABLE})`);
