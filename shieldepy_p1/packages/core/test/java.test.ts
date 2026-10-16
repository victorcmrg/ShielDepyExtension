import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSymbolNode, packageNodeId, type CodeGraph, type SymbolNodeAttrs } from '../src/index';
import { createGraph, Fixture, indexFile } from './helpers';

/** Id do método `name` da classe `container` no arquivo. */
function methodId(graph: CodeGraph, container: string, name: string, fileId: string): string {
  const id = graph.ownedSymbols(fileId).find((s) => {
    const a = graph.nodeAttributes(s);
    return a?.kind === 'method' && a.container === container && a.name === name;
  });
  if (!id) throw new Error(`método ${container}.${name} não encontrado`);
  return id;
}

function classAttrs(graph: CodeGraph, name: string, fileId: string): SymbolNodeAttrs {
  for (const id of graph.ownedSymbols(fileId)) {
    const a = graph.nodeAttributes(id);
    if (a && isSymbolNode(a) && a.kind === 'class' && a.name === name) return a;
  }
  throw new Error(`classe ${name} não encontrada`);
}

const MODEL = `package com.acme.model;

public class Order {
    private Long id;
    public void validate() { }
}
`;
const REPO = `package com.acme.repo;

import com.acme.model.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface OrderRepository extends JpaRepository<Order, Long> {
    List<Order> findByStatus(String status);
}
`;
const SERVICE = `package com.acme.service;

import com.acme.model.Order;
import com.acme.repo.OrderRepository;
import java.util.Optional;

public class OrderService {
    private final OrderRepository repository;
    private final AuditLog audit;

    public OrderService(OrderRepository repository, AuditLog audit) {
        this.repository = repository;
        this.audit = audit;
    }

    public Optional<Order> find(Long id) { return repository.findById(id); }

    public Order confirm(Long id) {
        var order = find(id).orElseThrow();
        order.validate();
        audit.record(order);
        repository.save(order);
        return order;
    }
}
`;
const AUDIT = `package com.acme.service;

public class AuditLog {
    public void record(Object o) { }
}
`;

describe('J1 — Java: símbolos, packages e chamadas', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('classes, records e enums com o package; métodos e construtores; interface comum não vira símbolo, repositório do Spring Data vira', () => {
    const f = indexFile(
      graph,
      fx,
      'Shapes.java',
      `package com.acme.shapes;
import org.springframework.data.repository.CrudRepository;
public interface Shape { double area(); }
public record Point(int x, int y) { }
enum Kind { A, B; void m() { } }
public class Circle implements Shape {
    public Circle(double r) { }
    public double area() { return 1; }
    static class Inner { void z() { } }
}
interface CircleRepository extends CrudRepository<Circle, Long> { Circle findByR(double r); }
`
    );
    const symbols = graph.ownedSymbols(f).map((id) => graph.nodeAttributes(id)).filter((a) => a && isSymbolNode(a)) as SymbolNodeAttrs[];
    expect(symbols.map((s) => `${s.kind}:${s.container ? s.container + '.' : ''}${s.name}`).sort()).toEqual([
      'class:Circle',
      'class:Circle.Inner',
      'class:CircleRepository',
      'class:Kind',
      'class:Point',
      'method:Circle.Circle',
      'method:Circle.area',
      'method:Inner.z',
      'method:Kind.m',
    ]);
    expect(classAttrs(graph, 'Circle', f)).toMatchObject({ namespace: 'com.acme.shapes', implements: ['Shape'] });
    expect(classAttrs(graph, 'CircleRepository', f)).toMatchObject({ extends: ['CrudRepository'], extendsArg: 'Circle' });
    expect(classAttrs(graph, 'Point', f).properties).toEqual(['x', 'y']);
  });

  it('serviço → repositório (Spring Data, com a entidade) e → classe do mesmo package; `Optional<T>` desembrulhado por `orElseThrow()`', () => {
    const model = indexFile(graph, fx, 'model/Order.java', MODEL);
    indexFile(graph, fx, 'repo/OrderRepository.java', REPO);
    const audit = indexFile(graph, fx, 'service/AuditLog.java', AUDIT);
    const svc = indexFile(graph, fx, 'service/OrderService.java', SERVICE);
    const confirm = methodId(graph, 'OrderService', 'confirm', svc);
    expect(graph.callsOf(confirm).map((c) => [c.name, c.outcome, c.package ?? c.model ?? ''])).toEqual([
      ['find', 'resolved', ''],
      ['orElseThrow', 'unbound', ''],
      ['validate', 'resolved', ''],
      ['record', 'resolved', ''],
      ['save', 'external', 'spring-data'],
    ]);
    expect(graph.hasEdge(confirm, methodId(graph, 'Order', 'validate', model), 'calls')).toBe(true);
    expect(graph.hasEdge(confirm, methodId(graph, 'AuditLog', 'record', audit), 'calls')).toBe(true);
    expect(graph.callsOf(confirm).find((c) => c.name === 'save')).toMatchObject({ model: 'Order' });
    expect(graph.callsOf(methodId(graph, 'OrderService', 'find', svc))[0]).toMatchObject({ name: 'findById', outcome: 'external', package: 'spring-data', model: 'Order' });
    expect(graph.fileCoverage(svc)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('visibilidade: `import x.*;`, o mesmo package e o import de uma classe; outro package sem import não', () => {
    const util = indexFile(graph, fx, 'util/Fmt.java', 'package com.acme.util;\npublic class Fmt { public static String go(String s) { return s; } }\n');
    const other = indexFile(graph, fx, 'other/Fmt.java', 'package com.other;\npublic class Fmt { public static String go(String s) { return s; } }\n');
    const caller = indexFile(
      graph,
      fx,
      'web/C.java',
      'package com.acme.web;\nimport com.acme.util.*;\npublic class C { void run() { Fmt.go("a"); com.other.Fmt.go("b"); } }\n'
    );
    const run = methodId(graph, 'C', 'run', caller);
    const sites = graph.callsOf(run);
    expect(sites[0]!.targets).toEqual([methodId(graph, 'Fmt', 'go', util)]);
    expect(sites[1]!.targets).toEqual([methodId(graph, 'Fmt', 'go', other)]);
  });

  it('`new X()`, `super.m()`, referência a método (`this::m`), injeção por `@Autowired` e Lombok `@Data`', () => {
    const f = indexFile(
      graph,
      fx,
      'Mix.java',
      `package com.acme;
import lombok.Data;
@Data
class Item { private String name; private boolean active; }
class Base { void hello() { } }
class Helper { Helper(int x) { } void run(Runnable r) { } }
public class Mix extends Base {
    @Autowired private Helper helper;
    void go(Item item) {
        new Helper(1);
        super.hello();
        helper.run(this::tick);
        item.getName();
        item.setActive(true);
        item.isActive();
    }
    void tick() { }
}
`
    );
    const go = methodId(graph, 'Mix', 'go', f);
    expect(graph.callsOf(go).map((c) => [c.name, c.outcome])).toEqual([
      ['Helper', 'resolved'],
      ['hello', 'resolved'],
      ['run', 'resolved'],
      ['getName', 'unbound'],
      ['setActive', 'unbound'],
      ['isActive', 'unbound'],
    ]);
    expect(graph.callsOf(go)[0]!.targets).toEqual([methodId(graph, 'Helper', 'Helper', f)]);
    expect(graph.hasEdge(go, methodId(graph, 'Mix', 'tick', f), 'references')).toBe(true);
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('tipos de fora só pelo import: `RestTemplate` do Spring vira pacote; uma classe `Repository` do projeto não é a do Spring', () => {
    const f = indexFile(
      graph,
      fx,
      'Clients.java',
      `package com.acme;
import org.springframework.web.client.RestTemplate;
class Repository { void save() { } }
public class Clients {
    private final RestTemplate rest = new RestTemplate();
    private final Repository repo = new Repository();
    void call() { rest.getForObject("https://api.x.com/v1", String.class); repo.save(); }
}
`
    );
    const sites = graph.callsOf(methodId(graph, 'Clients', 'call', f));
    expect(sites.map((c) => [c.name, c.outcome, c.package ?? ''])).toEqual([
      ['getForObject', 'external', 'spring-web-client'],
      ['save', 'resolved', ''],
    ]);
    expect(graph.hasEdge(f, packageNodeId('spring-web-client'), 'imports')).toBe(true);
  });

  it('o mapa não depende da ordem de indexação', async () => {
    const files: Array<[string, string]> = [
      ['service/OrderService.java', SERVICE],
      ['service/AuditLog.java', AUDIT],
      ['repo/OrderRepository.java', REPO],
      ['model/Order.java', MODEL],
    ];
    const edges = (g: CodeGraph) =>
      g
        .toSnapshot()
        .edges.map((e) => `${e.source}->${e.attributes.type}${e.attributes.heuristic ? '?' : ''}->${e.target}`)
        .sort();
    for (const [rel, text] of files) indexFile(graph, fx, rel, text);
    const other = await createGraph();
    for (const [rel, text] of [...files].reverse()) indexFile(other, fx, rel, text);
    expect(edges(other)).toEqual(edges(graph));
  });
});
