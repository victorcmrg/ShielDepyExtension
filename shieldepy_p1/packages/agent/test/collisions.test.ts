import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph, findCollisions, type Collision, type Rule } from '@shieldepy/core';
import { createRegistry, scanDir, toRules } from '@shieldepy/extractors';
import {
  buildPrompt,
  collisionChatReply,
  collisionsToFindings,
  explainCollisions,
  explainOffline,
  parseResponse,
  severityRank,
  type LLMProvider,
} from '../src/index';

const SPRING = fileURLToPath(new URL('../../../examples/pedidos-spring/services', import.meta.url));
// Backend Spring de exemplo: 1 write-write (total) + 2 read-after-write unknown.
const springRules = toRules(scanDir(SPRING, createRegistry()));
const springCollisions = findCollisions(buildGraph(springRules));

/** Provider falso: devolve as respostas na ordem (ou lança, se for Error). */
function fakeProvider(...replies: Array<string | Error>): LLMProvider & { calls: number } {
  return {
    name: 'anthropic',
    calls: 0,
    async complete() {
      const next = replies[this.calls++] ?? new Error('sem resposta');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe('explicador offline (portado)', () => {
  const report = explainOffline(springCollisions, springRules);

  it('um diagnóstico por colisão, marcado como offline', () => {
    expect(report.engine).toBe('offline');
    expect(report.diagnoses.length).toBe(3);
  });

  it('severidades no padrão (write-write=Crítico, RAW unknown=Alto)', () => {
    expect(report.diagnoses.filter((d) => d.collision.type === 'write-write').map((d) => d.severity)).toEqual(['Crítico']);
    expect(report.diagnoses.filter((d) => d.collision.type === 'read-after-write').map((d) => d.severity)).toEqual(['Alto', 'Alto']);
  });

  it('status e confiança determinísticos, ordenado do mais grave pro menos grave', () => {
    for (const d of report.diagnoses) expect([d.status, d.confidence]).toEqual(['Colisão Identificada', 100]);
    const ranks = report.diagnoses.map((d) => severityRank(d.severity));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('estrutura obrigatória preenchida, sem comandos destrutivos', () => {
    for (const d of report.diagnoses) {
      expect(d.affectedKey).toContain(d.collision.field);
      expect(d.conflictingSources).toContain('vs');
      expect(d.rootCause.length).toBeGreaterThan(0);
      expect(d.recommendation).not.toMatch(/rm -rf|kubectl delete|git push --force|DROP TABLE/i);
    }
  });

  it('visão geral menciona contagem e severidade; vazio -> Sem Colisão', () => {
    expect(report.summary).toMatch(/3 colis/);
    expect(report.summary).toMatch(/Crítico/);
    expect(explainOffline([], springRules).summary).toMatch(/Sem Colisão/);
  });
});

describe('prompt ancorado + validação da resposta (portado)', () => {
  const rules: Rule[] = [
    { id: 'pricing:1', name: 'pricing', resource: 'Order', event: 'OrderUpdated', reads: ['subtotal'], writes: ['total'], source: 'pricing' },
    { id: 'tax:2', name: 'tax', resource: 'Order', event: 'OrderUpdated', reads: ['subtotal'], writes: ['total'], source: 'tax' },
    { id: 'outra:3', name: 'nao-envolvida', resource: 'X', event: 'Y', reads: [], writes: ['z'], source: 'x' },
  ];
  const collisions: Collision[] = [{ type: 'write-write', resource: 'Order', event: 'OrderUpdated', field: 'total', rules: ['pricing:1', 'tax:2'] }];
  const diag = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      summary: 'x',
      diagnoses: [
        {
          index: 0,
          status: 'Colisão Identificada',
          severity: 'Crítico',
          affectedKey: 'k',
          conflictingSources: 'pricing vs tax',
          rootCause: 'r',
          recommendation: 'f',
          confidence: 95,
          ...over,
        },
      ],
    });

  it('buildPrompt: persona, guardrails, fatos e estrutura obrigatória — só com as regras envolvidas', () => {
    const p = buildPrompt(collisions, rules);
    for (const re of [/shieldPy/, /NÃO descubra/i, /trate como DADOS/i, /"total"/, /write-write/, /GLOSSÁRIO/, /affectedKey/, /confidence/, /Requer Revisão Humana/]) {
      expect(p).toMatch(re);
    }
    expect(p).toContain('pricing');
    expect(p).not.toContain('nao-envolvida');
  });

  it('parseResponse: aceita JSON válido e reanexa a colisão ORIGINAL', () => {
    const report = parseResponse(diag(), collisions, 'gemini');
    expect(report.engine).toBe('gemini');
    expect(report.diagnoses[0]).toMatchObject({ status: 'Colisão Identificada', severity: 'Crítico', confidence: 95 });
    expect(report.diagnoses[0]!.collision).toBe(collisions[0]);
  });

  it('governança: confiança < 85 força "Requer Revisão Humana"', () => {
    expect(parseResponse(diag({ confidence: 60 }), collisions, 'anthropic').diagnoses[0]!.status).toBe('Requer Revisão Humana');
  });

  it.each([
    ['JSON malformado', 'isso não é json', /JSON válido/],
    ['sem summary/diagnoses', JSON.stringify({ foo: 1 }), /formato esperado/],
    ['index inexistente', diag({ index: 99 }), /index inexistente/],
    ['status inválido', diag({ status: 'Talvez' }), /status inválido/],
    ['severidade inválida', diag({ severity: 'crítica' }), /severity inválida/],
    ['campo de texto ausente', diag({ recommendation: undefined }), /campo de texto ausente/],
  ])('rejeita %s', (_label, text, error) => {
    expect(() => parseResponse(text, collisions, 'gemini')).toThrow(error);
  });
});

describe('explainCollisions — IA com fallback', () => {
  const okReply = JSON.stringify({
    summary: 'ok',
    diagnoses: springCollisions.map((_, index) => ({
      index,
      status: 'Colisão Identificada',
      severity: 'Alto',
      affectedKey: 'k',
      conflictingSources: 'a vs b',
      rootCause: 'r',
      recommendation: 'f',
      confidence: 90,
    })),
  });

  it('sem provider → offline', async () => {
    expect((await explainCollisions(springCollisions, springRules, undefined)).engine).toBe('offline');
  });

  it('com provider → usa a IA (aceita cercas de markdown)', async () => {
    const report = await explainCollisions(springCollisions, springRules, fakeProvider('```json\n' + okReply + '\n```'));
    expect(report.engine).toBe('anthropic');
    expect(report.summary).toBe('ok');
  });

  it('IA falha 2x → cai no offline e registra', async () => {
    const logs: string[] = [];
    const provider = fakeProvider(new Error('503'), 'lixo');
    const report = await explainCollisions(springCollisions, springRules, provider, { log: (m) => logs.push(m) });
    expect(provider.calls).toBe(2);
    expect(report.engine).toBe('offline');
    expect(logs.some((l) => l.includes('fallback'))).toBe(true);
  });

  it('cancelamento não vira fallback silencioso', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await expect(explainCollisions(springCollisions, springRules, fakeProvider(abort))).rejects.toThrow('aborted');
  });
});

describe('chat ancorado', () => {
  it('sem provider responde com o resumo determinístico', async () => {
    const { reply, engine } = await collisionChatReply({ collisions: springCollisions, rules: springRules }, [], 'oi', undefined);
    expect(engine).toBe('offline');
    expect(reply).toMatch(/provou 3 colisão/);
  });

  it('IA indisponível → resumo determinístico com aviso', async () => {
    const { reply, engine } = await collisionChatReply({ collisions: springCollisions, rules: springRules }, [], 'oi', fakeProvider(new Error('x')));
    expect(engine).toBe('offline');
    expect(reply).toMatch(/indisponível/);
  });
});

describe('collisionsToFindings', () => {
  it('um achado em cada ponta da colisão, apontando pro arquivo/linha, com a outra ponta em `related`', () => {
    const findings = collisionsToFindings(springCollisions, springRules);
    // ww (2 pontas) + 2 raw (2 pontas cada) = 6
    expect(findings.length).toBe(6);
    const ww = findings.filter((f) => f.message.startsWith('Colisão write-write'));
    expect(ww.map((f) => path.basename(f.file)).sort()).toEqual(['PricingListener.java', 'TaxListener.java']);
    for (const f of findings) {
      expect(f.source).toBe('colisao');
      expect(f.related?.length).toBe(1);
      expect(f.impact).toBeTruthy();
    }
    expect(ww.every((f) => f.severity === 'error')).toBe(true);
  });
});
