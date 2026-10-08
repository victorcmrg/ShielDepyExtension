// Catálogo fixo de falhas de produção. Cada falha diz o que na superfície de ataque a habilita
// (e em qual alvo: host da API ou tabela). É o que limita a IA: ela só propõe falhas daqui, e só
// para rotas cujas tags as habilitam.

import type { SurfaceRoute } from '@shieldepy/core';

export type FailureId =
  | 'timeout'
  | 'http_5xx_intermittent'
  | 'malformed_response'
  | 'race_condition'
  | 'retry_storm'
  | 'partial_failure_after_external_call';

/** Quem escreve o teste: rede (MSW), concorrência (requisições em paralelo) ou banco (depois do MVP). */
export type ChaosAgent = 'network' | 'concurrency' | 'db_chaos';

export interface CatalogEntry {
  id: FailureId;
  agent: ChaosAgent;
  /** Uma linha, para o prompt e para o relatório. */
  description: string;
  /** Quais alvos da rota habilitam a falha (hosts ou tabelas); vazio = não se aplica. */
  targets(route: SurfaceRoute): string[];
  /** Entra na lista-base do motor (sem IA). Fora dela, só se a IA propuser. */
  baseline: boolean;
  /** Há template de teste no MVP. Sem template, a hipótese vai para o relatório sem teste. */
  testable: boolean;
}

/** Hosts das chamadas de API que dá pra interceptar (host `dynamic` não dá: não se sabe qual mockar). */
const apiHosts = (route: SurfaceRoute, onlyWithoutTimeout = false): string[] =>
  unique(
    route.operations
      .filter((o) => o.kind === 'api_call' && o.target !== 'dynamic' && (!onlyWithoutTimeout || o.timeout !== 'yes'))
      .map((o) => o.target)
  );

const tagTargets = (route: SurfaceRoute, ...tags: string[]): string[] =>
  unique(route.tags.filter((t) => tags.includes(t.tag)).flatMap((t) => t.targets ?? []).filter((t) => t !== 'dynamic'));

function unique(list: string[]): string[] {
  return [...new Set(list)].sort();
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'timeout',
    agent: 'network',
    description: 'A API externa demora além do razoável; a rota não pode deixar o cliente pendurado.',
    targets: (r) => apiHosts(r, true),
    baseline: true,
    testable: true,
  },
  {
    id: 'http_5xx_intermittent',
    agent: 'network',
    description: 'A API externa responde 5xx; a rota deve falhar de forma controlada e sem gravar meio pedido.',
    targets: (r) => apiHosts(r),
    baseline: true,
    testable: true,
  },
  {
    id: 'malformed_response',
    agent: 'network',
    description: 'A API externa devolve um corpo inválido; a rota não pode quebrar com exceção não tratada.',
    targets: (r) => apiHosts(r),
    baseline: true,
    testable: true,
  },
  {
    id: 'race_condition',
    agent: 'concurrency',
    description: 'Requisições simultâneas leem e escrevem o mesmo dado; o invariante de negócio não pode quebrar.',
    targets: (r) => tagTargets(r, 'read-then-write', 'multi-write-same-target'),
    baseline: true,
    testable: true,
  },
  {
    id: 'retry_storm',
    agent: 'network',
    description: 'Retentativas sem limite multiplicam a carga na API externa quando ela degrada.',
    targets: (r) => apiHosts(r),
    baseline: false,
    testable: false,
  },
  {
    id: 'partial_failure_after_external_call',
    agent: 'db_chaos',
    description: 'A API externa já foi chamada (ex.: cobrou) e a gravação seguinte falha; o sistema fica inconsistente.',
    targets: (r) => tagTargets(r, 'write-after-api-call'),
    baseline: true,
    testable: false,
  },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}
