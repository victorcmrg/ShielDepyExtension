import { collisionKey, collisionRuleIds, type Collision, type Finding, type FindingSeverity, type Rule } from '@shieldepy/core';
import { explainOffline } from './offline';
import type { Diagnosis, DiagnosisReport, Severity } from './types';

const TO_FINDING: Record<Severity, FindingSeverity> = {
  Crítico: 'error',
  Alto: 'warning',
  Médio: 'warning',
  Baixo: 'info',
};

/**
 * Frase curta do achado. Quem está do outro lado NÃO entra aqui: vai em `related` (Problems mostra
 * como informação relacionada, o painel e o hover mostram o código) — repetir no texto só alongava.
 */
function headline(c: Collision): string {
  if (c.type === 'write-write') return `Escrita dupla em "${c.field}" no evento ${c.event}.`;
  if (c.ordering === 'reader-first') return `"${c.field}" é lido antes de ser escrito no evento ${c.event}.`;
  if (c.ordering === 'writer-first') return `"${c.field}" é lido depois de ser escrito no evento ${c.event}.`;
  return `"${c.field}" é lido e escrito sem ordem garantida no evento ${c.event}.`;
}

/**
 * Converte colisões provadas em achados apontando pro código: um achado em CADA regra envolvida
 * que sabe onde está (a outra aparece em `related`). O texto vem do diagnóstico (IA ou offline).
 */
export function collisionsToFindings(collisions: Collision[], rules: Rule[], report?: DiagnosisReport): Finding[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const diagnoses = new Map<Collision, Diagnosis>((report ?? explainOffline(collisions, rules)).diagnoses.map((d) => [d.collision, d]));
  const findings: Finding[] = [];

  for (const c of collisions) {
    const diagnosis = diagnoses.get(c);
    const involved = collisionRuleIds(c).map((id) => byId.get(id));
    for (const rule of involved) {
      if (!rule?.location) continue;
      const others = involved.filter((o) => o && o !== rule && o.location);
      findings.push({
        file: rule.location.file,
        startLine: rule.location.line,
        endLine: rule.location.line,
        severity: TO_FINDING[diagnosis?.severity ?? 'Alto'],
        message: headline(c),
        impact: diagnosis ? `${diagnosis.rootCause} ${diagnosis.recommendation}` : undefined,
        source: 'colisao',
        related: others.map((o) => ({ file: o!.location!.file, line: o!.location!.line, message: `outra ponta da colisão: ${o!.name}` })),
        confidence: diagnosis?.confidence ?? 100,
        key: `${collisionKey(c)}@${rule.id}`,
      });
    }
  }

  return findings;
}
