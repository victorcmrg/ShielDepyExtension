// Pares para o DPO (D5, decisões 0016 e 0021) a partir dos registros do dataset. Sem rótulo humano:
// o par sai do próprio motor. O formato e os templates do prompt são os que a equipe de treino
// aprovou para o Llama-3.2-1B-Instruct.
//
// - correcao: o mesmo teste dá achado numa variante e "aguentou" noutra da mesma família
//   (`original` × `fixed`, ou `mutante:*` × o código que aguentou). O prompt é o código vulnerável
//   com o achado; o `chosen` é o código que aguentou (nunca um mutante); o `rejected`, o que ainda
//   dá achado.
// - diagnostico: na mesma rota e variante, uma falha deu achado (`chosen`) e outra aguentou
//   (`rejected`). Fraco: "aguentou" não prova que a rota é segura (C1, seção 4).
//
// Só entra registro com o controle verde (0001): o inválido nunca vira exemplo.

import { createHash } from 'node:crypto';
import type { CodeSlice, DatasetRecord } from './dataset';

export interface DpoPair {
  id: string;
  kind: 'correcao' | 'diagnostico';
  prompt: string;
  chosen: string;
  rejected: string;
  provenance: {
    family: string;
    /** Origem e licença do código (sem licença declarada, o campo não vem). */
    repo?: string;
    license?: string;
    commits: { chosen?: string; rejected?: string };
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

/** O template do `prompt` de correção, como a equipe de treino especificou. */
const correctionPrompt = (r: DatasetRecord) =>
  `Analise o seguinte código de rota e corrija a vulnerabilidade identificada:\n[VULNERABILIDADE / ACHADO]\nRota ${r.route.id}: ${finding(r)}\n\n[CÓDIGO DA ROTA]\n${renderCode(r.code)}\n\nResponda apenas com o código corrigido.`;

/** O template do `prompt` de diagnóstico, como a equipe de treino especificou. */
const diagnosisPrompt = (r: DatasetRecord) =>
  `Analise o seguinte código de rota e identifique potenciais vulnerabilidades de concorrência, latência ou estado:\n\n[CÓDIGO DA ROTA]\n${renderCode(r.code)}`;

function origin(chosen: DatasetRecord, rejected: DatasetRecord) {
  const { repo, license } = rejected.source;
  const commits = { ...(chosen.source.commit && { chosen: chosen.source.commit }), ...(rejected.source.commit && { rejected: rejected.source.commit }) };
  return { ...(repo && { repo }), ...(license && { license: license.value }), commits };
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
      // o chosen nunca é um mutante: ele aguentou esta falha, mas tem o defeito que a mutação pôs
      for (const good of group.filter((r) => valid(r, 'aguentou') && r.source.variant !== bad.source.variant && !r.source.mutation)) {
        pairs.push({
          id: pairId('correcao', bad.id, good.id),
          kind: 'correcao',
          prompt: correctionPrompt(bad),
          chosen: renderCode(good.code),
          rejected: renderCode(bad.code),
          provenance: {
            family: datasetFamily(bad),
            ...origin(good, bad),
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
          id: pairId('diagnostico', hit.id, held.id),
          kind: 'diagnostico',
          prompt: diagnosisPrompt(hit),
          chosen: finding(hit),
          rejected: `${held.hypothesis.failure} em ${held.hypothesis.target}`,
          provenance: {
            family: datasetFamily(hit),
            ...origin(hit, held),
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
