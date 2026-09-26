import { describe, expect, it } from 'vitest';
import {
  createRegistry,
  dotFieldAccess,
  extractPgFieldAccess,
  getterSetterAccess,
  parseCSharp,
  parseJava,
  parseNodeHandlers,
  parsePython,
  scanSources,
} from '../src/index';

describe('extratores regex (portados do Projeto18)', () => {
  it('dotFieldAccess: escreve e lê no mesmo agregado', () => {
    expect(dotFieldAccess('order.total = order.subtotal * 1.1;', 'order')).toEqual({ reads: ['subtotal'], writes: ['total'] });
  });

  it('dotFieldAccess: comparação (==, ===) não é escrita', () => {
    expect(dotFieldAccess('if (order.total === 0) {}', 'order')).toEqual({ reads: ['total'], writes: [] });
  });

  it('parseNodeHandlers: acha o evento, o recurso e os campos', () => {
    const hs = parseNodeHandlers('bus.on<Order>("order.updated", (order) => { order.prevTotal = order.total; });');
    expect(hs).toEqual([{ event: 'order.updated', resource: 'order', reads: ['total'], writes: ['prevTotal'], line: 0 }]);
  });

  it('getterSetterAccess: setX escreve, getX/isX lê', () => {
    expect(getterSetterAccess('e.setTotal(e.getSubtotal() * (e.isVip() ? 0.9 : 1));', 'e')).toEqual({
      reads: ['subtotal', 'vip'],
      writes: ['total'],
    });
  });

  it('parseJava: acha evento, recurso e campos', () => {
    const hs = parseJava('@EventListener\npublic void onOrderUpdated(OrderUpdated e) { e.setPrevTotal(e.getTotal()); }');
    expect(hs).toEqual([{ event: 'OrderUpdated', resource: 'Order', reads: ['total'], writes: ['prevTotal'], line: 0 }]);
  });

  it('parseJava: aceita modificadores, anotação com argumentos e evento qualificado', () => {
    const src = [
      '@EventListener(condition = "#e.total > 0")',
      '@Async',
      'public synchronized void on(final com.loja.PedidoAtualizado e) throws Exception {',
      '  e.setTotal(1);',
      '}',
    ].join('\n');
    expect(parseJava(src)).toEqual([{ event: 'PedidoAtualizado', resource: 'Pedido', reads: [], writes: ['total'], line: 0 }]);
  });

  it('parsePython: acha signal (evento), sender (recurso) e campos', () => {
    const src = ['@receiver(pre_save, sender=Order)', 'def snapshot(sender, instance, **kwargs):', '    instance.prev_total = instance.total', ''].join('\n');
    expect(parsePython(src)).toEqual([{ event: 'pre_save', resource: 'Order', reads: ['total'], writes: ['prev_total'], line: 0 }]);
  });

  it('parsePython: parâmetro da instância com outro nome (antes era fixo em "instance")', () => {
    const src = ['@receiver(post_save, sender=models.Order)', 'def f(sender, pedido, created, **kw):', '    pedido.total = 0', ''].join('\n');
    expect(parsePython(src)).toEqual([{ event: 'post_save', resource: 'Order', reads: [], writes: ['total'], line: 0 }]);
  });

  it('parseCSharp: acha evento (INotificationHandler<T>), recurso e campos', () => {
    const src = `
      public class AuditHandler : INotificationHandler<OrderUpdated> {
        public Task Handle(OrderUpdated notification, CancellationToken ct) {
          notification.PrevTotal = notification.Total;
          return Task.CompletedTask;
        }
      }`;
    expect(parseCSharp(src)).toEqual([{ event: 'OrderUpdated', resource: 'Order', reads: ['total'], writes: ['prevTotal'], line: 2 }]);
  });

  it('parseCSharp: evento com namespace no tipo', () => {
    const src = `class H : INotificationHandler<Events.OrderUpdated> {
      public Task Handle(Events.OrderUpdated n, CancellationToken ct) { n.Total = 1; return Task.CompletedTask; }
    }`;
    expect(parseCSharp(src).map((r) => [r.event, r.writes])).toEqual([['OrderUpdated', ['total']]]);
  });

  it('linha continua certa depois de comentário de bloco com várias linhas', () => {
    const src = '/*\n comentário\n longo\n*/\nbus.on("a.b", (x) => { x.y = 1; });';
    expect(parseNodeHandlers(src)[0]!.line).toBe(4);
  });

  describe('Postgres extractFieldAccess', () => {
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
  });

  it('registro único: escolhe extrator por extensão e aponta os ignorados', () => {
    const { items, skipped } = scanSources(
      [
        { name: 'PricingHandler.cs', content: 'class P : INotificationHandler<OrderUpdated> { public Task Handle(OrderUpdated n, CancellationToken c) { n.Total = 1; } }' },
        { name: 'notas.txt', content: 'nada' },
      ],
      createRegistry()
    );
    expect(items.map((i) => [i.service, i.event, i.writes])).toEqual([['PricingHandler', 'OrderUpdated', ['total']]]);
    expect(skipped).toEqual(['notas.txt']);
  });
});
