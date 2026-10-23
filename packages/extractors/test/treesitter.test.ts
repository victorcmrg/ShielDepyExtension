import { beforeAll, describe, expect, it } from 'vitest';
import { TsParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { parseTsHandlers } from '../src/index';

let parser: TsParser;
beforeAll(async () => {
  parser = await TsParser.load(defaultWasmDir());
});

/** Só o que importa pra colisão: evento → [lê, escreve]. */
const access = (src: string) => parseTsHandlers(parser, src).map((r) => ({ event: r.event, reads: r.reads, writes: r.writes }));

describe('extrator Tree-sitter de handlers (TS/JS)', () => {
  it('caso básico: igual ao regex', () => {
    expect(access('bus.on<Order>("order.updated", (order) => { order.prevTotal = order.total; });')).toEqual([
      { event: 'order.updated', reads: ['total'], writes: ['prevTotal'] },
    ]);
  });

  it('parâmetro desestruturado conta como leitura', () => {
    expect(access("bus.on('order.updated', ({ total, subtotal: s }) => { log(total, s); });")).toEqual([
      { event: 'order.updated', reads: ['subtotal', 'total'], writes: [] },
    ]);
  });

  it('alias do payload: `const o = order; o.total = ...`', () => {
    expect(access("bus.on('order.updated', (order) => { const o = order; o.total = o.subtotal * 2; });")).toEqual([
      { event: 'order.updated', reads: ['subtotal'], writes: ['total'] },
    ]);
  });

  it('destructuring no corpo: `const { total } = order`', () => {
    expect(access("bus.on('order.updated', (order) => { const { total } = order; log(total); });")).toEqual([
      { event: 'order.updated', reads: ['total'], writes: [] },
    ]);
  });

  it('handler nomeado (função declarada e arrow em const)', () => {
    const src = [
      'function applyTax(order: Order) { order.total = order.subtotal * 1.1; }',
      'const snapshot = (o: Order) => { o.prevTotal = o.total; };',
      "bus.on('order.updated', applyTax);",
      "bus.once('order.updated', snapshot);",
    ].join('\n');
    expect(access(src)).toEqual([
      { event: 'order.updated', reads: ['subtotal'], writes: ['total'] },
      { event: 'order.updated', reads: ['total'], writes: ['prevTotal'] },
    ]);
  });

  it('`+=`, `++`, subscript com string e Object.assign', () => {
    const src = `emitter.addListener('cart.changed', (cart) => {
      cart.total += cart.shipping;
      cart.version++;
      cart['discount'] = 0;
      Object.assign(cart, { status: 'dirty', updatedAt });
    });`;
    expect(access(src)).toEqual([
      { event: 'cart.changed', reads: ['shipping', 'total', 'version'], writes: ['discount', 'status', 'total', 'updatedAt', 'version'] },
    ]);
  });

  it('chamada de método no payload NÃO é leitura de campo', () => {
    expect(access("bus.on('order.updated', (order) => { order.recalc(order.items); });")).toEqual([
      { event: 'order.updated', reads: ['items'], writes: [] },
    ]);
  });

  it('sombreamento: `order` de uma função interna não é o payload', () => {
    const src = `bus.on('order.updated', (order) => {
      order.total = 1;
      others.forEach((order) => { order.total = 2; order.flag = true; });
    });`;
    expect(access(src)).toEqual([{ event: 'order.updated', reads: [], writes: ['total'] }]);
  });

  it('template string estática vale como nome de evento; dinâmica é ignorada', () => {
    const src = 'bus.on(`order.paid`, (o) => { o.paidAt = now(); });\nbus.on(`order.${kind}`, (o) => { o.x = 1; });';
    expect(access(src)).toEqual([{ event: 'order.paid', reads: [], writes: ['paidAt'] }]);
  });

  it('chamadas que não registram handler são ignoradas', () => {
    expect(access("bus.emit('order.updated', order);\nconsole.on;\nfoo('x', () => {});")).toEqual([]);
  });

  it('linha da regra = linha do registro', () => {
    const rules = parseTsHandlers(parser, "\n\n\nbus.on('a.b', (x) => { x.y = 1; });");
    expect(rules[0]!.line).toBe(3);
  });
});
