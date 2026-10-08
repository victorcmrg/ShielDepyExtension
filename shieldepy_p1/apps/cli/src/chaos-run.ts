// Runner dos testes de caos (E4): roda o Vitest do projeto-alvo com o reporter JSON e classifica
// cada hipótese pelo par controle × caos. Controle falhou = o teste ou o ambiente está ruim
// (`invalid`, não bloqueia); controle passou e caos falhou = achado (`failed`); os dois passaram =
// o código aguentou a falha (`passed`). O processo é injetado para testar sem rodar o Vitest.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CHAOS_TESTS_DIR, CONTROL_TEST_NAME, specFileName } from '@shieldepy/agent/chaos';

export type TestStatus = 'passed' | 'failed' | 'invalid';

export interface TestResult {
  hypothesisId: string;
  status: TestStatus;
  /** `failed`: a invariante violada; `invalid`: por que o resultado não vale. */
  message?: string;
  /** Duração do teste de caos (ou do controle, quando só ele rodou). */
  durationMs: number;
}

/** O pedaço do JSON do reporter do Vitest que o runner lê (medido no 3e/E4). */
interface VitestJson {
  testResults?: {
    name: string;
    status?: string;
    message?: string;
    assertionResults?: { ancestorTitles?: string[]; title: string; status: string; failureMessages?: string[]; duration?: number | null }[];
  }[];
}

/**
 * Primeira linha da falha, sem o tipo do erro e sem o "expected ..." do Chai:
 * `AssertionError: stateCheck: stockNeverNegative: expected false to be true` → `stateCheck: stockNeverNegative`.
 */
export function cleanFailureMessage(raw: string | undefined): string {
  if (!raw) return 'falhou sem mensagem';
  let line = raw.split('\n', 1)[0]!.trim();
  line = line.replace(/^(AssertionError|Error|TypeError|RangeError): /, '');
  const expected = line.indexOf(': expected ');
  if (expected > 0) line = line.slice(0, expected);
  return line || 'falhou sem mensagem';
}

const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

/**
 * Classifica o JSON do reporter. `expected` são as hipóteses que têm teste gerado: a que não
 * aparecer no resultado sai `invalid` ("não rodou"), em vez de sumir do relatório.
 */
export function classifyVitestReport(report: VitestJson, expected: string[]): TestResult[] {
  const byFile = new Map(expected.map((id) => [specFileName(id), id]));
  const results = new Map<string, TestResult>();

  for (const file of report.testResults ?? []) {
    const tests = file.assertionResults ?? [];
    if (tests.length === 0) {
      // o arquivo nem carregou (não compilou, import quebrado): o id vem do nome do arquivo
      const id = byFile.get(baseName(file.name));
      if (id) results.set(id, { hypothesisId: id, status: 'invalid', message: `o teste não carregou: ${cleanFailureMessage(file.message)}`, durationMs: 0 });
      continue;
    }
    const ids = new Set(tests.map((t) => t.ancestorTitles?.[0]).filter((x): x is string => !!x));
    for (const id of ids) {
      const mine = tests.filter((t) => t.ancestorTitles?.[0] === id);
      const control = mine.find((t) => t.title === CONTROL_TEST_NAME);
      const chaos = mine.find((t) => t.title !== CONTROL_TEST_NAME);
      const ms = (t?: { duration?: number | null }) => Math.round(t?.duration ?? 0);
      if (!control || control.status !== 'passed') {
        const why = control ? (control.status === 'failed' ? cleanFailureMessage(control.failureMessages?.[0]) : control.status) : 'não encontrado';
        results.set(id, { hypothesisId: id, status: 'invalid', message: `o controle (sem caos) falhou: ${why}`, durationMs: ms(control) });
      } else if (!chaos || (chaos.status !== 'passed' && chaos.status !== 'failed')) {
        results.set(id, { hypothesisId: id, status: 'invalid', message: `o teste de caos não rodou${chaos ? ` (${chaos.status})` : ''}`, durationMs: ms(control) });
      } else if (chaos.status === 'failed') {
        results.set(id, { hypothesisId: id, status: 'failed', message: cleanFailureMessage(chaos.failureMessages?.[0]), durationMs: ms(chaos) });
      } else results.set(id, { hypothesisId: id, status: 'passed', durationMs: ms(chaos) });
    }
  }

  for (const id of expected) if (!results.has(id)) results.set(id, { hypothesisId: id, status: 'invalid', message: 'o teste não rodou (sem resultado no relatório do Vitest)', durationMs: 0 });
  const order = new Map(expected.map((id, i) => [id, i]));
  return [...results.values()].sort((a, b) => (order.get(a.hypothesisId) ?? Infinity) - (order.get(b.hypothesisId) ?? Infinity) || a.hypothesisId.localeCompare(b.hypothesisId));
}

/** Erro de ambiente: o Vitest não pôde rodar (vira exit 2 no gate, nunca um achado). */
export class ChaosRunError extends Error {}

export interface ProcessResult {
  code: number | null;
  /** Fim da saída do processo, para diagnóstico. */
  output: string;
}

export type ProcessRunner = (command: string, args: string[], cwd: string) => Promise<ProcessResult>;

const OUTPUT_TAIL = 4000;

export const spawnProcess: ProcessRunner = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_TAIL);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });

/** O Vitest instalado no projeto-alvo. Sem `npx`: no Windows ele exige shell, e o caminho tem espaço. */
export function vitestEntry(root: string): string | undefined {
  const entry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  return existsSync(entry) ? entry : undefined;
}

/**
 * Roda `vitest run --config .shieldepy/chaos-tests/vitest.config.ts --reporter=json` na raiz do
 * projeto. O JSON vai para um arquivo temporário: o stdout mistura os logs do app.
 */
export async function runChaosTests(root: string, expected: string[], run: ProcessRunner = spawnProcess): Promise<TestResult[]> {
  const entry = vitestEntry(root);
  if (!entry) throw new ChaosRunError(`o Vitest não está instalado em ${root} (rode npm install/npm ci no projeto antes)`);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'shieldepy-chaos-'));
  const outputFile = path.join(tmp, 'vitest.json');
  try {
    const { code, output } = await run(
      process.execPath,
      [entry, 'run', '--config', `${CHAOS_TESTS_DIR}/vitest.config.ts`, '--reporter=json', `--outputFile=${outputFile}`],
      root
    );
    let raw: string;
    try {
      raw = await readFile(outputFile, 'utf8');
    } catch {
      throw new ChaosRunError(`o Vitest saiu com código ${code} sem gerar o relatório:\n${output.trim()}`);
    }
    let report: VitestJson;
    try {
      report = JSON.parse(raw) as VitestJson;
    } catch {
      throw new ChaosRunError('o relatório JSON do Vitest veio inválido');
    }
    return classifyVitestReport(report, expected);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
