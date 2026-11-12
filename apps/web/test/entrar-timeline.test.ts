// O roteiro da encenação do "Entrar" (decisão 0039): a duração cabe no combinado, a ordem faz
// sentido e cada bloco quebrado é corrigido uma vez.
import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  EVENTS,
  NOT_FOUND_MS,
  REBUILD_MS,
  STAGES,
  TITLE_BROKEN,
  TITLE_FIXED,
  decodeFrame,
  fixTime,
  snapshot,
  stageTime,
  stepAt,
  timecode,
} from '../src/portal/pages/entrar/timeline';

describe('roteiro do Entrar', () => {
  it('o 404 fica 1,5 s e a reconstrução cabe entre 6 e 8 s', () => {
    expect(NOT_FOUND_MS).toBe(1500);
    expect(REBUILD_MS).toBeGreaterThanOrEqual(6000);
    expect(REBUILD_MS).toBeLessThanOrEqual(8000);
    expect(EVENTS.at(-1)!.at).toBeLessThan(REBUILD_MS);
  });

  it('os eventos vêm em ordem de tempo', () => {
    for (let i = 1; i < EVENTS.length; i++) expect(EVENTS[i]!.at).toBeGreaterThanOrEqual(EVENTS[i - 1]!.at);
  });

  it('cada bloco é corrigido exatamente uma vez, depois do esqueleto aparecer', () => {
    for (const b of BLOCKS) {
      expect(EVENTS.filter((e) => e.fix === b)).toHaveLength(1);
      expect(fixTime(b)).toBeGreaterThan(stageTime('skeleton'));
    }
  });

  it('as etapas acontecem uma vez cada, na ordem declarada', () => {
    const order = EVENTS.flatMap((e) => (e.stage ? [e.stage] : []));
    expect(order).toEqual([...STAGES]);
  });

  it('no fim está tudo corrigido e a última mensagem é de sucesso', () => {
    const end = snapshot(stepAt(REBUILD_MS));
    expect(end.fixed.size).toBe(BLOCKS.length);
    expect(end.stages.size).toBe(STAGES.length);
    expect(end.logs.at(-1)!.tone).toBe('ok');
  });

  it('no começo não há nada na tela além do 404 marcado', () => {
    expect(stepAt(-1)).toBe(0);
    const start = snapshot(stepAt(0));
    expect([...start.stages]).toEqual(['marked']);
    expect(start.fixed.size).toBe(0);
  });
});

describe('decodificação do título', () => {
  it('vai do texto quebrado ao certo', () => {
    expect(decodeFrame(TITLE_BROKEN, TITLE_FIXED, 0)).toBe(TITLE_BROKEN);
    expect(decodeFrame(TITLE_BROKEN, TITLE_FIXED, 1)).toBe(TITLE_FIXED);
    expect(decodeFrame(TITLE_BROKEN, TITLE_FIXED, 2)).toBe(TITLE_FIXED);
  });

  it('no meio, o começo já está certo e o mesmo instante dá o mesmo texto', () => {
    const mid = decodeFrame(TITLE_BROKEN, TITLE_FIXED, 0.5, 3);
    expect(mid.startsWith(TITLE_FIXED.slice(0, 7))).toBe(true);
    expect(mid).not.toBe(TITLE_FIXED);
    expect(decodeFrame(TITLE_BROKEN, TITLE_FIXED, 0.5, 3)).toBe(mid);
  });
});

describe('timecode', () => {
  it('conta minutos, segundos e quadros a 24 por segundo', () => {
    expect(timecode(0)).toBe('00:00:00');
    expect(timecode(1500)).toBe('00:01:12');
    expect(timecode(61_000)).toBe('01:01:00');
    expect(timecode(-5)).toBe('00:00:00');
  });
});
