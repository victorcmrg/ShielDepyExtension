// Pares para o DPO (D5, decisão 0016) a partir dos registros do dataset. Sem rótulo humano: o par
// sai do próprio motor. Formato provisório, `{ prompt, chosen, rejected, provenance }`, até a outra
// equipe confirmar o dela.
//
// - correção: o mesmo teste dá achado numa variante e "aguentou" noutra da mesma família
//   (`original` × `fixed`, ou `mutante:*` × o código que aguentou). O prompt é o código vulnerável
//   com o achado; o `chosen` é o código que aguentou; o `rejected`, o que ainda dá achado.
// - diagnóstico: na mesma rota e variante, uma falha deu achado (`chosen`) e outra aguentou
//   (`rejected`). Fraco: "aguentou" não prova que a rota é segura (C1, seção 4).
//
// Só entra registro com o controle verde (0001): o inválido nunca vira exemplo.

import { createHash } from 'node:crypto';
import type { CodeSlice, DatasetRecord } from './dataset';

export interface DpoPair {
  id: string;
  kind: 'correção' | 'diagnóstico';
  prompt: string;
  chosen: string;
  rejected: string;
  provenance: {
    family: string;
    hypothesisId: string;
    routeId: string;
    /** Os registros do dataset de onde o par saiu (`DatasetRecord.id`). */
    chosenRecord: string;
    rejectedRecord: string;
    variants: { chosen: string; rejected: string };
    /** "Aguentou" de um lado só diz que aquela falha não quebrou aquele teste. */
    weak?: true;
  };
}

/** A família de um projeto: o exemplo e o corrigido dele (`-fixed`) e os mutantes são a mesma. */
export const datasetFamily = (r: Pick<DatasetRecord, 'source'>) =>
  [r.source.repo ?? '', r.source.project.endsWith('-fixed') ? r.source.project.slice(0, -'-fixed'.length) : r.source.project].join(' ');

const valid = (r: DatasetRecord, outcome: 'achado' | 'aguentou') => r.result.control === 'passed' && r.result.outcome === outcome;

export function renderCode(code: CodeSlice[]): string {
  return code.map((c) => `// ${c.at}\n${c.text}`).join('\n\n');
}

function finding(r: DatasetRecord): string {
  return `${r.hypothesis.failure} em ${r.hypothesis.target}${r.result.message ? `: ${r.result.message}` : ''}${r.result.severity ? ` (${r.result.severity})` : ''}`;
}

function route(r: DatasetRecord): string {
  const ops = r.route.operations.map((o) => `${o.order}. ${o.kind} ${o.target} (${o.via}${o.operation ? ` ${o.operation}` : ''}${o.timeout ? `, timeout: ${o.timeout}` : ''}) em ${o.in}, ${o.at}`);
  return `Rota ${r.route.id} (${r.route.at}), cadeia: ${r.route.handlers.join(' → ')}\nOperações em ordem:\n${ops.join('\n')}`;
}

const pairId = (...parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function dpoPairs(records: DatasetRecord[]): DpoPair[] {
  const pairs: DpoPair[] = [];

  // correção: mesma família e mesma hipótese, achado de um lado e aguentou do outro
  const byHypothesis = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const key = `${datasetFamily(r)}\n${r.hypothesis.id}`;
    byHypothesis.set(key, [...(byHypothesis.get(key) ?? []), r]);
  }
  for (const group of byHypothesis.values()) {
    for (const bad of group.filter((r) => valid(r, 'achado'))) {
      for (const good of group.filter((r) => valid(r, 'aguentou') && r.source.variant !== bad.source.variant)) {
        pairs.push({
          id: pairId('correção', bad.id, good.id),
          kind: 'correção',
          prompt: `${route(bad)}\n\nO teste de caos achou: ${finding(bad)}.\nCorrija o código para que a rota aguente essa falha.\n\n${renderCode(bad.code)}`,
          chosen: renderCode(good.code),
          rejected: renderCode(bad.code),
          provenance: {
            family: datasetFamily(bad),
            hypothesisId: bad.hypothesis.id,
            routeId: bad.route.id,
            chosenRecord: good.id,
            rejectedRecord: bad.id,
            variants: { chosen: good.source.variant, rejected: bad.source.variant },
          },
        });
      }
    }
  }

  // diagnóstico: mesma rota e mesma variante, uma falha deu achado e outra aguentou
  const byRoute = new Map<string, DatasetRecord[]>();
  for (const r of records) {
    const key = `${datasetFamily(r)}\n${r.source.project}\n${r.source.variant}\n${r.route.id}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), r]);
  }
  for (const group of byRoute.values()) {
    for (const hit of group.filter((r) => valid(r, 'achado'))) {
      for (const held of group.filter((r) => valid(r, 'aguentou'))) {
        pairs.push({
          id: pairId('diagnóstico', hit.id, held.id),
          kind: 'diagnóstico',
          prompt: `${route(hit)}\n\nQual falha de produção quebra esta rota, e que invariante ela viola?\n\n${renderCode(hit.code)}`,
          chosen: finding(hit),
          rejected: `${held.hypothesis.failure} em ${held.hypothesis.target}`,
          provenance: {
            family: datasetFamily(hit),
            hypothesisId: hit.hypothesis.id,
            routeId: hit.route.id,
            chosenRecord: hit.id,
            rejectedRecord: held.id,
            variants: { chosen: hit.source.variant, rejected: held.source.variant },
            weak: true,
          },
        });
      }
    }
  }

  return pairs.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.provenance.family, b.provenance.family) || cmp(a.provenance.hypothesisId, b.provenance.hypothesisId) || cmp(a.id, b.id));
}
