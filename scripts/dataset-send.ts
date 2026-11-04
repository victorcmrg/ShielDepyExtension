// O envio do corpus pronto ao banco do treino (decisões 0020 e 0022): lê o `dataset.jsonl` final, depois do
// `dataset:gerar` e do `dataset:mutantes`, e grava por upsert no `id`. Os pares vão depois, com
// `dataset:pares --in` no mesmo arquivo.
//
//   npm run dataset:enviar -- --in <dataset.jsonl>
//
// O banco é o da variável SHIELDEPY_DATASET_DATABASE_URL.

import * as path from 'node:path';
import { DATASET_DB_ENV, DATASET_TABLE, dbHost, publishDatasetFile } from '../apps/cli/src/dataset';
import { arg } from './real-projects';

const input = arg('--in');
const url = process.env[DATASET_DB_ENV]?.trim() || undefined;
if (!input || !url) {
  console.error(`uso: npm run dataset:enviar -- --in <dataset.jsonl>\nO banco vem da variável ${DATASET_DB_ENV}.`);
  process.exit(2);
}

try {
  const { sent, duplicates } = await publishDatasetFile(path.resolve(input), url);
  console.log(`✓ ${sent} registro(s) em ${dbHost(url)} (tabela ${DATASET_TABLE})${duplicates ? `; ${duplicates} repetido(s) por id no arquivo` : ''}`);
} catch (err) {
  console.error(`⚠ não deu para enviar a ${dbHost(url)}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
