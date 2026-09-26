// Explicador determinístico (sem IA). Plano B que roda SEM chave/internet, na MESMA estrutura
// declarativa do shieldPy. Vem direto da prova do motor, então a confiança é 100%.

import type { Collision, Rule } from '@shieldepy/core';
import { defaultSeverity, severityRank, type Diagnosis, type DiagnosisReport } from './types';

function nameOf(rules: Map<string, Rule>, id: string): string {
  return rules.get(id)?.name ?? id;
}

export function diagnoseOffline(c: Collision, rules: Map<string, Rule>): Diagnosis {
  const common = {
    collision: c,
    status: 'Colisão Identificada' as const,
    severity: defaultSeverity(c),
    affectedKey: `${c.resource}/${c.event} · campo "${c.field}"`,
    confidence: 100,
  };

  if (c.type === 'write-write') {
    const a = nameOf(rules, c.rules[0]);
    const b = nameOf(rules, c.rules[1]);
    return {
      ...common,
      conflictingSources: `${a} vs ${b}`,
      rootCause:
        `Duas regras escrevem o mesmo campo "${c.field}" no mesmo recurso+evento, sem precedência definida. ` +
        `O valor final depende de quem gravar por último, sobrescrevendo a outra escrita silenciosamente.`,
      recommendation:
        `Eleja uma única regra responsável por escrever "${c.field}" nesse evento, ou encadeie "${a}" e "${b}" ` +
        `em ordem explícita (uma consome o resultado da outra) em vez de escreverem em paralelo.`,
    };
  }

  const reader = nameOf(rules, c.reader);
  const writer = nameOf(rules, c.writer);
  const conflictingSources = `${reader} (leitura) vs ${writer} (escrita)`;

  if (c.ordering === 'unknown') {
    return {
      ...common,
      conflictingSources,
      rootCause:
        `"${reader}" lê "${c.field}" que "${writer}" escreve, mas a ordem de execução não é garantida. ` +
        `O valor lido é intermitente (ora atualizado, ora não), tornando o resultado imprevisível entre execuções.`,
      recommendation:
        `Estabeleça uma ordem explícita para "${writer}" executar antes de "${reader}", ` +
        `ou separe em eventos encadeados; alternativamente, "${reader}" deve recalcular o valor em vez de depender do gravado.`,
    };
  }

  if (c.ordering === 'reader-first') {
    return {
      ...common,
      conflictingSources,
      rootCause:
        `Pela ordem atual, "${reader}" executa antes de "${writer}" e lê o valor desatualizado de "${c.field}". ` +
        `O erro é determinístico, porém silencioso (usa sempre o valor antigo).`,
      recommendation:
        `Inverta a ordem para "${writer}" executar antes de "${reader}", ` +
        `ou faça "${reader}" recalcular "${c.field}" em vez de ler o valor previamente gravado.`,
    };
  }

  return {
    ...common,
    conflictingSources,
    rootCause:
      `Pela ordem atual, "${writer}" executa antes de "${reader}", que lê o valor já atualizado de "${c.field}". ` +
      `Está correto hoje, mas é frágil: qualquer mudança de ordem reintroduz o defeito.`,
    recommendation: `Documente e trave essa dependência de ordem (a corretude depende de "${writer}" preceder "${reader}").`,
  };
}

function buildSummary(diagnoses: Diagnosis[]): string {
  if (diagnoses.length === 0) {
    return 'Sem Colisão: analisei os metadados e não encontrei conflitos nos eventos avaliados.';
  }
  const criticos = diagnoses.filter((d) => d.severity === 'Crítico').length;
  const altos = diagnoses.filter((d) => d.severity === 'Alto').length;
  const partes = [`Analisei os metadados e identifiquei ${diagnoses.length} colisão(ões)`];
  if (criticos) partes.push(`${criticos} de severidade Crítico`);
  if (altos) partes.push(`${altos} de severidade Alto`);
  partes.push(`a mais grave afeta ${diagnoses[0]!.affectedKey}`);
  return partes.join('; ') + '.';
}

/** Relatório de diagnóstico por regras determinísticas (sem rede). */
export function explainOffline(collisions: Collision[], rules: Rule[]): DiagnosisReport {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const diagnoses = collisions
    .map((c) => diagnoseOffline(c, byId))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return { summary: buildSummary(diagnoses), diagnoses, engine: 'offline' };
}
