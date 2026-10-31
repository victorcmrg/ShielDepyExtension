// Dados para treinar a IA de erros de produção (D1, decisão 0016): um registro por hipótese que
// rodou, com o código da rota, a hipótese, a spec, o teste gerado e o resultado. O rótulo vem da
// execução (controle × caos), nunca de um LLM juiz. Função pura: quem chama lê o disco e o git.

import { createHash } from 'node:crypto';
import { canonicalJson, type AttackSurface, type CodeGraph, type SurfaceOperation, type TopologyRoute } from '@shieldepy/core';
import type { Engine } from '../provider';
import type { FailureId } from './catalog';
import type { Hypothesis, RejectedHypothesis } from './hypotheses';
import type { ChaosOutcome } from './results';
import type { ChaosSpec, Invariant } from './specs';
import { CHAOS_TESTS_DIR, DB_NOT_FIRED, specFileName, type GeneratedFile } from './templates';

export const DATASET_SCHEMA_VERSION = 1;

/** `mutante:<operador>@<arquivo>:<linha>` sai da D4 (mutação pela AST de um código que aguentou). */
export type DatasetVariant = 'original' | 'fixed' | `mutante:${string}`;

/** De onde o código veio: só código público ou nosso entra no treino (0016). */
export interface DatasetSource {
  /** Nome do projeto (a pasta analisada). */
  project: string;
  /** Remote do git (`origin`), quando há. */
  repo?: string;
  commit?: string;
  /** A pasta analisada relativa à raiz do repositório (`examples/checkout-express`); `.` na raiz. */
  path?: string;
  /** O `license` do `package.json`, ou a primeira linha do `LICENSE`. */
  license?: { value: string; from: 'package.json' | 'LICENSE' };
  variant: DatasetVariant;
  /** Só nos mutantes: o que foi tirado do código que aguentou (`source` é o do original). */
  mutation?: { operator: string; file: string; line: number; description: string };
}

/** O corpo de uma função da cadeia da rota, recortado pela faixa do símbolo no grafo (nó do Tree-sitter). */
export interface CodeSlice {
  /** Id do símbolo, relativo ao projeto (`src/services/CheckoutService.ts#CheckoutService.checkout`). */
  symbol: string;
  /** `src/services/CheckoutService.ts:12` (1-based, a primeira linha do símbolo). */
  at: string;
  /** Última linha do símbolo (1-based). */
  endLine: number;
  /** O texto, com quebra de linha `\n`. */
  text: string;
}

/** Quem escreveu: o motor (offline) ou a IA, com o modelo. */
export type DatasetAuthor = { engine: 'offline' } | { engine: Exclude<Engine, 'offline'>; model?: string };

export type DatasetOutcome = 'achado' | 'aguentou' | 'inválido';
export type DatasetRunStatus = 'passed' | 'failed' | 'not-run';

export interface DatasetRecord {
  /** Hash do projeto, do repositório, da variante, do motor, da hipótese e do conteúdo (código, spec, teste); sem o commit. */
  id: string;
  schemaVersion: typeof DATASET_SCHEMA_VERSION;
  source: DatasetSource;
  topologyHash: string;
  route: {
    id: string;
    method: string;
    path: string;
    at: string;
    /** A cadeia como está no registro da rota (middlewares e handler, em ordem). */
    handlers: string[];
    operations: Pick<SurfaceOperation, 'order' | 'kind' | 'target' | 'via' | 'operation' | 'lock' | 'timeout' | 'at' | 'in' | 'confidence'>[];
    tags: { tag: string; targets?: string[] }[];
    confidence: 'proven' | 'heuristic';
    truncated?: true;
  };
  /** Os handlers da rota e as funções no caminho até cada I/O, na ordem em que aparecem. */
  code: CodeSlice[];
  hypothesis: {
    id: string;
    failure: FailureId;
    agent: Hypothesis['agent'];
    target: string;
    priority: Hypothesis['priority'];
    rationale: string;
    author: DatasetAuthor;
    /** A spec validada que virou o teste. */
    spec: ChaosSpec;
    specAuthor: DatasetAuthor;
    /** O que a validação descartou nesta execução (propostas da IA fora do catálogo ou da superfície, specs refeitas pelo motor). */
    discarded: string[];
  };
  result: {
    /** O teste sem caos. Um registro só é exemplo (positivo ou negativo) com o controle `passed` (0001). */
    control: DatasetRunStatus;
    chaos: DatasetRunStatus;
    outcome: DatasetOutcome;
    /** A invariante que quebrou (achado), ou por que o resultado não vale (inválido). */
    message?: string;
    violated?: Invariant;
    severity?: ChaosOutcome['severity'];
    durationMs: number;
  };
  test: { file: string; text: string };
}

export interface DatasetInput {
  source: DatasetSource;
  surface: AttackSurface;
  /** O código da cadeia de cada rota, por id da rota (`routeCode`). */
  code: Record<string, CodeSlice[]>;
  engine: Engine;
  /** O modelo da IA que escreveu as hipóteses e as specs (o das chamadas da execução). */
  model?: string;
  hypotheses: Hypothesis[];
  rejected: RejectedHypothesis[];
  specs: ChaosSpec[];
  /** Os erros que não pararam o pipeline (`<agente> <hipótese>: <motivo>`). */
  errors: string[];
  files: GeneratedFile[];
  outcomes: ChaosOutcome[];
}

const OUTCOME: Record<ChaosOutcome['status'], DatasetOutcome> = { failed: 'achado', passed: 'aguentou', invalid: 'inválido' };

/**
 * O controle e o caos de um resultado. `passed`/`failed` só existem com o controle verde; o
 * `invalid` diz qual parte não valeu pela mensagem do runner (`classifyVitestReport`, na CLI).
 */
export function runStatuses(outcome: Pick<ChaosOutcome, 'status' | 'message'>): { control: DatasetRunStatus; chaos: DatasetRunStatus } {
  if (outcome.status === 'passed') return { control: 'passed', chaos: 'passed' };
  if (outcome.status === 'failed') return { control: 'passed', chaos: 'failed' };
  const m = outcome.message ?? '';
  if (m.startsWith('o controle (sem caos) falhou')) return { control: 'failed', chaos: 'not-run' };
  if (m.startsWith('o teste de caos não rodou')) return { control: 'passed', chaos: 'not-run' };
  // DB_Chaos sem a gravação alvo depois da API: o caos rodou, mas a falha não foi injetada
  if (m.startsWith(DB_NOT_FIRED)) return { control: 'passed', chaos: 'not-run' };
  return { control: 'not-run', chaos: 'not-run' };
}

/** A invariante da spec que a mensagem do achado cita (`stateCheck: stockNeverNegative`, `respondsWithin: ...`). */
function violatedInvariant(spec: ChaosSpec, message: string | undefined): Invariant | undefined {
  if (!message) return undefined;
  const colon = message.indexOf(':');
  const kind = colon > 0 ? message.slice(0, colon) : message;
  const matches = spec.expect.filter((i) => i.kind === kind);
  if (kind === 'stateCheck') {
    const name = message.slice(colon + 1).trim();
    return matches.find((i) => i.kind === 'stateCheck' && i.name === name);
  }
  return matches[0];
}

const author = (engine: Engine, model: string | undefined, byAi: boolean): DatasetAuthor =>
  byAi && engine !== 'offline' ? { engine, ...(model && { model }) } : { engine: 'offline' };

/**
 * O id: o projeto, o repositório, a pasta, a variante, o motor, a hipótese e o **conteúdo** que o
 * modelo vê (o código da cadeia, a spec e o teste). O commit fica de fora: um commit novo do
 * repositório que não muda o código do exemplo dá o mesmo id, e o upsert no banco não duplica.
 */
export function datasetRecordId(record: Pick<DatasetRecord, 'source' | 'code' | 'test'> & { hypothesis: Pick<DatasetRecord['hypothesis'], 'id' | 'spec'> }, engine: Engine): string {
  const { source } = record;
  const content = createHash('sha256')
    .update(canonicalJson({ code: record.code, spec: record.hypothesis.spec, test: record.test.text }))
    .digest('hex');
  const key = [source.project, source.repo ?? '', source.path ?? '', source.variant, engine, record.hypothesis.id, content].join('\n');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/** Um registro por hipótese que rodou (com resultado), em ordem de id. Sem resultado não há rótulo: fica fora. */
export function buildDatasetRecords(input: DatasetInput): DatasetRecord[] {
  const routes = new Map(input.surface.routes.map((r) => [r.id, r]));
  const hypotheses = new Map(input.hypotheses.map((h) => [h.id, h]));
  const specs = new Map(input.specs.map((s) => [s.hypothesisId, s]));
  const files = new Map(input.files.map((f) => [f.path, f.content]));
  const rejected = input.rejected.map((r) => `threat_modeler #${r.index}: ${r.reason}`);

  const records: DatasetRecord[] = [];
  for (const o of input.outcomes) {
    const h = hypotheses.get(o.hypothesisId);
    const spec = specs.get(o.hypothesisId);
    const route = h && routes.get(h.routeId);
    if (!h || !spec || !route) continue;
    const testFile = `${CHAOS_TESTS_DIR}/${specFileName(h.id)}`;
    const mine = ` ${h.id}: `;
    const statuses = runStatuses(o);
    const violated = o.status === 'failed' ? violatedInvariant(spec, o.message) : undefined;
    const record: Omit<DatasetRecord, 'id'> = {
      schemaVersion: DATASET_SCHEMA_VERSION,
      source: input.source,
      topologyHash: input.surface.topologyHash,
      route: {
        id: route.id,
        method: route.method,
        path: route.path,
        at: route.at,
        handlers: route.handlers,
        operations: route.operations.map((op) => ({
          order: op.order,
          kind: op.kind,
          target: op.target,
          via: op.via,
          ...(op.operation && { operation: op.operation }),
          ...(op.lock && { lock: op.lock }),
          ...(op.timeout && { timeout: op.timeout }),
          at: op.at,
          in: op.in,
          confidence: op.confidence,
        })),
        tags: route.tags,
        confidence: route.confidence,
        ...(route.truncated && { truncated: route.truncated }),
      },
      code: input.code[route.id] ?? [],
      hypothesis: {
        id: h.id,
        failure: h.failure,
        agent: h.agent,
        target: h.target,
        priority: h.priority,
        rationale: h.rationale,
        author: author(input.engine, input.model, h.source !== 'motor'),
        spec,
        specAuthor: author(input.engine, input.model, spec.source === 'ia'),
        discarded: [...rejected, ...input.errors.filter((e) => e.includes(mine))],
      },
      result: {
        ...statuses,
        outcome: OUTCOME[o.status],
        ...(o.message && { message: o.message }),
        ...(violated && { violated }),
        ...(o.severity && { severity: o.severity }),
        durationMs: o.durationMs,
      },
      test: { file: testFile, text: files.get(testFile) ?? '' },
    };
    records.push({ id: datasetRecordId(record, input.engine), ...record });
  }
  return records.sort((a, b) => (a.hypothesis.id < b.hypothesis.id ? -1 : a.hypothesis.id > b.hypothesis.id ? 1 : 0));
}

/** JSONL: um registro por linha, chaves em ordem (a mesma entrada dá o mesmo texto). */
export function datasetJsonl(records: DatasetRecord[]): string {
  return records.map((r) => canonicalJson(r) + '\n').join('');
}

/**
 * O registro de um mutante (que rodou numa cópia do projeto) com a fonte do original: mesmo
 * projeto, repositório e commit, variante `mutante:...` e a mutação. O id é refeito com ela.
 */
export function asMutantRecord(record: DatasetRecord, base: DatasetSource, mutation: NonNullable<DatasetSource['mutation']>, variant: DatasetVariant, engine: Engine): DatasetRecord {
  const source: DatasetSource = { ...base, variant, mutation };
  return { ...record, source, id: datasetRecordId({ ...record, source }, engine) };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Junta arquivos JSONL num corpus: um registro por `id` (o último lido vence, como numa nova
 * execução), em ordem de projeto, variante e hipótese. Linha que não é registro v1 é contada e fica fora.
 */
export function mergeDatasetJsonl(texts: string[]): { records: DatasetRecord[]; duplicates: number; skipped: number } {
  const byId = new Map<string, DatasetRecord>();
  let duplicates = 0;
  let skipped = 0;
  for (const text of texts) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let r: DatasetRecord;
      try {
        r = JSON.parse(line) as DatasetRecord;
      } catch {
        skipped++;
        continue;
      }
      if (r?.schemaVersion !== DATASET_SCHEMA_VERSION || typeof r.id !== 'string') {
        skipped++;
        continue;
      }
      if (byId.has(r.id)) duplicates++;
      byId.set(r.id, r);
    }
  }
  const records = [...byId.values()].sort(
    (a, b) => cmp(a.source.project, b.source.project) || cmp(a.source.variant, b.source.variant) || cmp(a.hypothesis.id, b.hypothesis.id) || cmp(a.id, b.id)
  );
  return { records, duplicates, skipped };
}

/** Os símbolos da cadeia de uma rota: os handlers, depois cada função no caminho até um I/O, sem repetir. */
export function chainSymbols(route: Pick<TopologyRoute, 'handlers' | 'operations'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  for (const h of route.handlers) if (!h.package && !h.opaque) h.symbols.forEach(add);
  for (const op of [...route.operations].sort((a, b) => a.order - b.order)) op.through.forEach(add);
  return out;
}

/**
 * O código da cadeia de cada rota: a faixa de linhas de cada símbolo no grafo (que vem do nó do
 * Tree-sitter), nunca regex. `rootId` é o `toFileId` da pasta (os ids da topologia são relativos a
 * ela); `read` devolve o texto de um arquivo pelo id.
 */
export function routeCode(
  routes: Pick<TopologyRoute, 'id' | 'handlers' | 'operations'>[],
  graph: Pick<CodeGraph, 'nodeAttributes'>,
  rootId: string,
  read: (fileId: string) => string | undefined
): Record<string, CodeSlice[]> {
  const lines = new Map<string, string[] | undefined>();
  const linesOf = (fileId: string) => {
    if (!lines.has(fileId)) lines.set(fileId, read(fileId)?.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)));
    return lines.get(fileId);
  };
  const base = rootId.endsWith('/') ? rootId : `${rootId}/`;
  const out: Record<string, CodeSlice[]> = {};
  for (const route of routes) {
    const slices: CodeSlice[] = [];
    for (const symbol of chainSymbols(route)) {
      const attrs = graph.nodeAttributes(base + symbol);
      if (!attrs || (attrs.kind !== 'function' && attrs.kind !== 'method')) continue;
      const text = linesOf(attrs.file);
      if (!text) continue;
      const relFile = symbol.slice(0, symbol.indexOf('#'));
      slices.push({ symbol, at: `${relFile}:${attrs.startLine + 1}`, endLine: attrs.endLine + 1, text: text.slice(attrs.startLine, attrs.endLine + 1).join('\n') });
    }
    out[route.id] = slices;
  }
  return out;
}
