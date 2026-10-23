// Como o caos aparece no portal (V3): o tom e o texto de cada status, falha, operação e tag. Num lugar
// só, para a página do projeto e a da execução falarem igual.
import type { IconName } from '../ui/Icon';
import type { RunStatus, RunSummary, SurfaceOperation } from '../types';

export type Tone = 'danger' | 'ok' | 'warn' | 'muted';

export const STATUS: Record<RunStatus, { label: string; tone: Tone; icon: IconName }> = {
  blocked: { label: 'Bloqueado', tone: 'danger', icon: 'alert' },
  below_gate: { label: 'Passou no portão', tone: 'warn', icon: 'shield' },
  passed: { label: 'Aguentou', tone: 'ok', icon: 'check' },
  nothing: { label: 'Nada a testar', tone: 'ok', icon: 'check' },
  not_run: { label: 'Não executado', tone: 'muted', icon: 'pause' },
  error: { label: 'Erro de ambiente', tone: 'warn', icon: 'alert' },
  invalid: { label: 'Nada provado', tone: 'warn', icon: 'alert' },
};

/** A frase grande do topo da execução. */
export function statusSentence(run: RunSummary): string {
  switch (run.status) {
    case 'blocked':
      return run.hits === 1 ? 'Um achado barrou este PR' : run.hits + ' achados barraram este PR';
    case 'below_gate':
      return 'Passou no portão, com ' + run.failed + ' achado(s) abaixo da severidade ' + run.failOn;
    case 'passed':
      return 'O código aguentou todas as falhas injetadas';
    case 'nothing':
      return 'Este PR não tocou nenhuma rota sensível';
    case 'not_run':
      return 'Os testes foram gerados, mas não rodaram';
    case 'error':
      return 'Os testes não rodaram (erro de ambiente)';
    case 'invalid':
      return 'Nada foi provado: todos os testes saíram inválidos';
  }
}

/** Nome de cada falha do catálogo, como uma pessoa diria. */
export const FAILURE: Record<string, { label: string; hint: string }> = {
  race_condition: { label: 'Corrida', hint: 'requisições iguais ao mesmo tempo' },
  timeout: { label: 'API lenta', hint: 'a resposta demora além da paciência do cliente' },
  http_5xx_intermittent: { label: 'API com erro', hint: 'a API responde 5xx' },
  malformed_response: { label: 'Resposta inválida', hint: 'a API devolve um corpo que não serve' },
  retry_storm: { label: 'Tempestade de retentativas', hint: 'retentativas sem limite sobrecarregam a API' },
  partial_failure_after_external_call: { label: 'Falha parcial', hint: 'o banco falha depois da chamada externa' },
};
export const failureLabel = (id: string) => FAILURE[id]?.label ?? id;

/** Verbo da operação de I/O, para a linha do tempo da rota. */
export function opVerb(op: SurfaceOperation): string {
  switch (op.kind) {
    case 'db_read':
      return 'lê';
    case 'db_write':
      return 'grava';
    case 'db_tx':
      return 'transação';
    case 'db_unknown':
      return 'banco';
    case 'api_call':
      return 'chama';
  }
}
export const opIcon = (op: SurfaceOperation): IconName => (op.kind === 'api_call' ? 'cloud' : 'database');

/** Tags de sensibilidade em linguagem de gente. */
const TAG: Record<string, string> = {
  'external-io': 'chama API externa',
  'no-timeout': 'sem timeout',
  'read-then-write': 'lê e depois grava',
  'no-transaction': 'sem transação',
  'multi-write-same-target': 'grava duas vezes',
  'write-after-api-call': 'grava depois da API',
};
export const tagLabel = (tag: string) => TAG[tag] ?? tag;

/** Severidade → tom. */
export const severityTone = (severity?: string): Tone => (severity === 'Crítico' ? 'danger' : severity === 'Alto' ? 'warn' : 'muted');

export const shortSha = (sha: string) => sha.slice(0, 7);

export function formatUsd(usd: number): string {
  if (usd === 0) return 'sem custo de IA';
  return 'US$ ' + (usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)).replace('.', ',');
}
