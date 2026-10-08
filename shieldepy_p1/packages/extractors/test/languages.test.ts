import { beforeAll, describe, expect, it } from 'vitest';
import { GrammarParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import {
  extractPgFieldAccess,
  loadRegistry,
  parseCSharp,
  parseJava,
  parsePython,
  scanSources,
  tokenizePlpgsql,
} from '../src/index';

let java: GrammarParser;
let python: GrammarParser;
let csharp: GrammarParser;

beforeAll(async () => {
  [java, python, csharp] = await Promise.all([
    GrammarParser.load(defaultWasmDir(), 'java'),
    GrammarParser.load(defaultWasmDir(), 'python'),
    GrammarParser.load(defaultWasmDir(), 'c_sharp'),
  ]);
});

describe('Java / Spring (Tree-sitter)', () => {
  it('acha evento, recurso e campos (getters/setters)', () => {
    const hs = parseJava(java, '@EventListener\npublic void onOrderUpdated(OrderUpdated e) { e.setPrevTotal(e.getTotal()); }');
    expect(hs).toEqual([{ event: 'OrderUpdated', resource: 'Order', reads: ['total'], writes: ['prevTotal'], line: 0 }]);
  });

  it('aceita modificadores, anotação com argumentos e evento qualificado', () => {
    const src = [
      '@EventListener(condition = "#e.total > 0")',
      '@Async',
      'public synchronized void on(final com.loja.PedidoAtualizado e) throws Exception {',
      '  e.setTotal(1);',
      '}',
    ].join('\n');
    expect(parseJava(java, src)).toEqual([{ event: 'PedidoAtualizado', resource: 'Pedido', reads: [], writes: ['total'], line: 0 }]);
  });

  it('AST: @TransactionalEventListener, campo direto, `+=`, e comentário/string não contam', () => {
    const src = [
      'class L {',
      '  @TransactionalEventListener',
      '  void on(OrderUpdated e) {',
      '    // e.setIgnorado(1);',
      '    String s = "e.setTambemIgnorado(2)";',
      '    e.total += e.discount;',
      '    e.isVip();',
      '  }',
      '}',
    ].join('\n');
    expect(parseJava(java, src)).toEqual([{ event: 'OrderUpdated', resource: 'Order', reads: ['discount', 'total', 'vip'], writes: ['total'], line: 1 }]);
  });

  it('evento só na anotação: `@EventListener(classes = OrderPaid.class)`', () => {
    const src = 'class L { @EventListener(classes = OrderPaid.class) void on() {} }';
    expect(parseJava(java, src).map((r) => [r.event, r.resource])).toEqual([['OrderPaid', 'Order']]);
  });
});

describe('Python / Django (Tree-sitter)', () => {
  it('acha signal (evento), sender (recurso) e campos', () => {
    const src = ['@receiver(pre_save, sender=Order)', 'def snapshot(sender, instance, **kwargs):', '    instance.prev_total = instance.total', ''].join('\n');
    expect(parsePython(python, src)).toEqual([{ event: 'pre_save', resource: 'Order', reads: ['total'], writes: ['prev_total'], line: 0 }]);
  });

  it('parâmetro da instância com outro nome', () => {
    const src = ['@receiver(post_save, sender=models.Order)', 'def f(sender, pedido, created, **kw):', '    pedido.total = 0', ''].join('\n');
    expect(parsePython(python, src)).toEqual([{ event: 'post_save', resource: 'Order', reads: [], writes: ['total'], line: 0 }]);
  });

  it('AST: lista de signals, `.connect()`, `+=` e método chamado na instância', () => {
    const src = [
      '@receiver([pre_save, post_save], sender=Order)',
      'def count(sender, instance, **kw):',
      '    instance.hits += 1',
      '    instance.save()  # instance.ignorado = 1',
      '',
      'def audit(sender, instance, **kw):',
      '    instance.audited = instance.total',
      '',
      'post_delete.connect(audit, sender=Order)',
      '',
    ].join('\n');
    expect(parsePython(python, src)).toEqual([
      { event: 'pre_save', resource: 'Order', reads: ['hits'], writes: ['hits'], line: 0 },
      { event: 'post_save', resource: 'Order', reads: ['hits'], writes: ['hits'], line: 0 },
      { event: 'post_delete', resource: 'Order', reads: ['total'], writes: ['audited'], line: 8 },
    ]);
  });
});

describe('C# / MediatR (Tree-sitter)', () => {
  it('acha evento (INotificationHandler<T>), recurso e campos', () => {
    const src = `
      public class AuditHandler : INotificationHandler<OrderUpdated> {
        public Task Handle(OrderUpdated notification, CancellationToken ct) {
          notification.PrevTotal = notification.Total;
          return Task.CompletedTask;
        }
      }`;
    expect(parseCSharp(csharp, src)).toEqual([{ event: 'OrderUpdated', resource: 'Order', reads: ['total'], writes: ['prevTotal'], line: 2 }]);
  });

  it('evento com namespace no tipo', () => {
    const src = `class H : INotificationHandler<Events.OrderUpdated> {
      public Task Handle(Events.OrderUpdated n, CancellationToken ct) { n.Total = 1; return Task.CompletedTask; }
    }`;
    expect(parseCSharp(csharp, src).map((r) => [r.event, r.writes])).toEqual([['OrderUpdated', ['total']]]);
  });

  it('AST: classe com dois handlers, `++`/`+=` e método chamado no parâmetro', () => {
    const src = `class H : INotificationHandler<OrderPaid>, INotificationHandler<OrderShipped> {
      public Task Handle(OrderPaid n, CancellationToken ct) { n.PaidCount++; n.Recalculate(); return Task.CompletedTask; }
      public Task Handle(OrderShipped s, CancellationToken ct) { s.Weight += s.Extra; return Task.CompletedTask; }
    }`;
    expect(parseCSharp(csharp, src).map((r) => [r.event, r.reads, r.writes])).toEqual([
      ['OrderPaid', ['paidCount'], ['paidCount']],
      ['OrderShipped', ['extra', 'weight'], ['weight']],
    ]);
  });
});

describe('Postgres — analisador léxico de PL/pgSQL', () => {
  it('escrita simples', () => {
    expect(extractPgFieldAccess('BEGIN NEW.updated_at := now(); RETURN NEW; END;')).toEqual({ reads: [], writes: ['updated_at'] });
  });

  it('lê no lado direito e escreve no esquerdo', () => {
    expect(extractPgFieldAccess('BEGIN NEW.total := NEW.subtotal * (1 - discount(NEW.customer_tier)); RETURN NEW; END;')).toEqual({
      reads: ['customer_tier', 'subtotal'],
      writes: ['total'],
    });
  });

  it('ignora comentários e RETURN NEW', () => {
    expect(extractPgFieldAccess('BEGIN -- NEW.ignorado := 1;\n NEW.audit_prev_total := NEW.total; RETURN NEW; END;')).toEqual({
      reads: ['total'],
      writes: ['audit_prev_total'],
    });
  });

  it('comparação com `=` não é escrita', () => {
    expect(extractPgFieldAccess('IF NEW.status = OLD.status THEN RETURN NEW; END IF;')).toEqual({ reads: ['status'], writes: [] });
  });

  it('léxico: `=` no início do comando é atribuição; string, comentário aninhado e aspas', () => {
    const src = [
      'CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $fn$',
      'BEGIN',
      "  NEW.total = NEW.subtotal;        -- '=' atribuindo",
      "  RAISE NOTICE 'NEW.fake := 1';    -- dentro de string",
      '  /* fora /* aninhado NEW.x := 1 */ ainda comentário */',
      '  NEW."Status" := OLD.Status;',
      "  EXECUTE $q$ UPDATE t SET a = NEW.dyn $q$;",
      '  RETURN NEW;',
      'END;',
      '$fn$;',
    ].join('\n');
    expect(extractPgFieldAccess(src)).toEqual({ reads: ['status', 'subtotal'], writes: ['Status', 'total'] });
  });

  it('tokens: dollar-quote do corpo vira código, o de dentro vira string', () => {
    const kinds = tokenizePlpgsql("AS $$ x $a$ y $a$ 'z' $$").map((t) => (t.kind === 'ident' ? t.value : t.kind));
    expect(kinds).toEqual(['AS', 'x', 'string', 'string']);
  });
});

describe('registro', () => {
  it('escolhe extrator por extensão e aponta os ignorados', async () => {
    const { items, skipped } = scanSources(
      [
        { name: 'PricingHandler.cs', content: 'class P : INotificationHandler<OrderUpdated> { public Task Handle(OrderUpdated n, CancellationToken c) { n.Total = 1; } }' },
        { name: 'notas.txt', content: 'nada' },
      ],
      await loadRegistry(defaultWasmDir())
    );
    expect(items.map((i) => [i.service, i.event, i.writes])).toEqual([['PricingHandler', 'OrderUpdated', ['total']]]);
    expect(skipped).toEqual(['notas.txt']);
  });

  it('gramática ausente tira só a sua linguagem (sem cair em regex)', async () => {
    const registry = await loadRegistry('/pasta/sem/wasm');
    expect(registry.extractors).toEqual([]);
    expect(registry.failed.sort()).toEqual(['csharp', 'java', 'python', 'ts']);
    expect(registry.forPath('A.java')).toBeUndefined();
  });
});
