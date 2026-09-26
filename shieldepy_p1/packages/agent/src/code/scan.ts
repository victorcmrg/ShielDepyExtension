// Varredura de risco em background: arquivo (ou só o trecho alterado) + subgrafo + fatos provados.

import type { FindingSeverity, GraphSnapshot } from '@shieldepy/core';
import type { LLMProvider, Logger } from '../provider';
import { stripFences, withLineNumbers } from '../text';
import { SCAN_SYSTEM_PROMPT } from './prompts';

export interface RiskFinding {
  startLine: number;
  endLine: number;
  severity: FindingSeverity;
  message: string;
  impact?: string;
}

export interface ScanRequest {
  /** O arquivo inteiro, ou só o trecho que mudou (aí `startLine` é o offset real no arquivo). */
  text: string;
  subgraph: GraphSnapshot;
  startLine?: number;
  /** Nome do idioma (ver `languageName`). */
  language: string;
  /** Ciclos/colisões já provados — a IA não deve repeti-los (é o grounding do scan). */
  provenFacts?: string[];
  signal?: AbortSignal;
}

/** Varredura leve em background: devolve achados estruturados, descartando itens fora do formato. */
export async function scanForRisks(provider: LLMProvider, req: ScanRequest, log?: Logger): Promise<RiskFinding[]> {
  const startLine = req.startLine ?? 0;
  const parts = [
    startLine > 0
      ? `TRECHO ALTERADO DO ARQUIVO (numerado por linha, começando em ${startLine} — o resto do arquivo não mudou desde a última varredura e já foi verificado):`
      : 'ARQUIVO ATUAL (numerado por linha, 0-indexado):',
    '```',
    withLineNumbers(req.text, startLine),
    '```',
    '',
    'SUBGRAFO DE IMPACTO (nós e arestas adjacentes no grafo de arquitetura):',
    '```json',
    JSON.stringify(req.subgraph),
    '```',
  ];
  if (req.provenFacts && req.provenFacts.length > 0) {
    parts.push('', 'FATOS PROVADOS (já mostrados ao usuário — não repita):', ...req.provenFacts.map((f) => `- ${f}`));
  }

  const raw = stripFences(
    await provider.complete({
      system: `${SCAN_SYSTEM_PROMPT}\n\nOs campos "message" e "impact" devem ser escritos em ${req.language}.`,
      messages: [{ role: 'user', content: parts.join('\n') }],
      tier: 'fast',
      maxTokens: 2000,
      json: true,
      signal: req.signal,
    })
  );
  return parseRiskFindings(raw, log);
}

export function parseRiskFindings(raw: string, log?: Logger): RiskFinding[] {
  if (!raw) {
    log?.('[scan] a IA retornou texto vazio.');
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log?.(`[scan] resposta não era JSON válido: ${err}. Bruto: ${raw.slice(0, 300)}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    log?.(`[scan] resposta não é um array: ${raw.slice(0, 300)}`);
    return [];
  }
  const findings = parsed.filter(isValidRiskFinding);
  if (findings.length !== parsed.length) {
    log?.(`[scan] ${parsed.length - findings.length} item(ns) descartado(s) por formato inválido.`);
  }
  return findings.map((f) => ({ ...f, impact: f.impact || undefined }));
}

function isValidRiskFinding(value: unknown): value is RiskFinding {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    Number.isInteger(c.startLine) &&
    Number.isInteger(c.endLine) &&
    (c.startLine as number) >= 0 &&
    (c.endLine as number) >= (c.startLine as number) &&
    typeof c.message === 'string' &&
    (c.impact === undefined || typeof c.impact === 'string') &&
    (c.severity === 'error' || c.severity === 'warning' || c.severity === 'info')
  );
}
