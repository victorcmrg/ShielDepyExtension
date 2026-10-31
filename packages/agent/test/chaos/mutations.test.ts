import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TsParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { applyEdits, findMutations, mutantVariant } from '../../src/chaos';

const FIXED = fileURLToPath(new URL('../../../../examples/checkout-express-fixed/', import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(FIXED, rel), 'utf8');

describe('D4 — mutantes pela AST', () => {
  it('checkout-express-fixed: tira o timeout, tira o estorno e cobra antes de reservar', async () => {
    const parser = await TsParser.load(defaultWasmDir());
    const gateway = read('src/gateways/StripeGateway.ts');
    const timeouts = findMutations(parser, 'src/gateways/StripeGateway.ts', gateway);
    // um mutante por sítio: o fetch da cobrança e o do estorno
    expect(timeouts.map((m) => `${m.operator} ${m.line} ${m.description}`)).toEqual(['sem-timeout 17 tira o signal de fetch', 'sem-timeout 36 tira o signal de fetch']);
    const noTimeout = applyEdits(gateway, timeouts[0]!.edits);
    expect(noTimeout.split('AbortSignal.timeout').length - 1).toBe(1); // só o do estorno ficou
    expect(noTimeout.split('\n').length).toBe(gateway.split('\n').length - 1); // a linha inteira saiu
    expect(noTimeout).toContain("body: new URLSearchParams({ amount: String(amountCents), currency: 'brl', source: token }),\r\n      });".replace(/\r\n/g, gateway.includes('\r\n') ? '\r\n' : '\n'));
    expect(mutantVariant(timeouts[0]!)).toBe('mutante:sem-timeout@src/gateways/StripeGateway.ts:17');

    const service = read('src/services/CheckoutService.ts');
    const ms = findMutations(parser, 'src/services/CheckoutService.ts', service);
    expect(ms.map((m) => m.operator)).toEqual(['cobra-antes-de-reservar', 'sem-estorno']);

    const swapped = applyEdits(service, ms[0]!.edits);
    const at = (s: string) => swapped.indexOf(s);
    expect(at('let charge: Charge;')).toBeLessThan(at('const reserved = await this.stock.reserve'));
    expect(at('charge = await this.payments.charge(')).toBeLessThan(at('const reserved = await this.stock.reserve'));
    expect(at('if (!reserved) throw new OutOfStockError')).toBeLessThan(at('return await this.orders.insert'));
    // só a ordem mudou (a linha em branco entre os blocos movidos sai)
    const lines = (t: string) => t.split(/\r?\n/).filter((l) => l.trim()).sort();
    expect(lines(swapped)).toEqual(lines(service));

    const noRefund = applyEdits(service, ms[1]!.edits);
    expect(noRefund).toContain('const refunded = false;');
    expect(noRefund).not.toContain('this.payments.refund(');
    // o arquivo continua TypeScript válido: o mutante parseia sem erro
    for (const t of [noTimeout, swapped, noRefund]) expect(parser.withTree(t, false, (root) => root.hasError)).toBe(false);
  });

  it('sem-transacao: tira BEGIN/COMMIT/ROLLBACK da função, lidos pelo léxico do SQL', async () => {
    const parser = await TsParser.load(defaultWasmDir());
    const text = [
      'export async function transfer(client: any) {',
      "  await client.query('BEGIN');",
      '  try {',
      "    await client.query('UPDATE accounts SET balance = balance - 1 WHERE id = 1');",
      "    await client.query(`COMMIT`);",
      '  } catch (err) {',
      "    await client.query('rollback');",
      '    throw err;',
      '  }',
      '}',
      'export async function onlyCommit(client: any) {',
      "  await client.query('COMMIT -- sem BEGIN aqui');",
      "  await client.query('SELECT 1');",
      '}',
      '',
    ].join('\n');
    const ms = findMutations(parser, 'src/tx.ts', text);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ operator: 'sem-transacao', line: 2, description: 'tira BEGIN/COMMIT/ROLLBACK da função' });
    const out = applyEdits(text, ms[0]!.edits);
    expect(out).toContain("await client.query('UPDATE accounts");
    expect(out).not.toContain("'BEGIN'");
    expect(out).not.toContain('`COMMIT`');
    expect(out).not.toContain("'rollback'");
    expect(out).toContain("'COMMIT -- sem BEGIN aqui'"); // a outra função não tem BEGIN: fica
    expect(out.split('\n')).toHaveLength(text.split('\n').length - 3);
  });
});
