import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemGraph, buildTopology, findExpressRoutes, indexFiles, ioOperationOf, isSymbolNode, listSourceFiles, packageNodeId, silentHost, type CodeGraph, type SymbolNodeAttrs } from '../src/index';
import { createGraph, Fixture, indexFile, REPO_ROOT } from './helpers';

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

describe('J2 — rotas do Spring MVC', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const summary = () =>
    findExpressRoutes(graph)
      .routes.map((r) => `${r.id} → ${r.handlers.map((h) => h.label).join(', ')}`)
      .sort();

  it('`@RequestMapping` na classe; verbos com e sem caminho, `value`/`path`, listas e `@RequestMapping(method = ...)`', () => {
    indexFile(
      graph,
      fx,
      'OrderController.java',
      `package com.acme.web;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @GetMapping
    public String list() { return ""; }

    @GetMapping("/{id}")
    public String get(@PathVariable Long id) { return ""; }

    @PostMapping(value = {"/a", "/b"}, consumes = "application/json")
    public void create() { }

    @RequestMapping(path = "/x", method = RequestMethod.PUT)
    public void put() { }

    @RequestMapping(value = "/any")
    public void any() { }

    @DeleteMapping(path = "{id}")
    public void delete(@PathVariable Long id) { }
}

@RestController
class HealthController {
    @GetMapping("/health")
    public String ping() { return "ok"; }
}
`
    );
    expect(summary()).toEqual([
      'ALL /api/orders/any → OrderController.any',
      'DELETE /api/orders/{id} → OrderController.delete',
      'GET /api/orders → OrderController.list',
      'GET /api/orders/{id} → OrderController.get',
      'GET /health → HealthController.ping',
      'POST /api/orders/a → OrderController.create',
      'POST /api/orders/b → OrderController.create',
      'PUT /api/orders/x → OrderController.put',
    ]);
  });

  it('anotação `GetMapping` do próprio projeto (sem o import do Spring) não é rota; caminho não literal vai para `skipped`', () => {
    indexFile(graph, fx, 'Fake.java', 'package com.acme;\n@interface GetMapping { String value(); }\nclass C { @GetMapping("/x") void m() { } }\n');
    indexFile(
      graph,
      fx,
      'Dyn.java',
      'package com.acme;\nimport org.springframework.web.bind.annotation.GetMapping;\nclass D { static final String P = "/p"; @GetMapping(P) void m() { } }\n'
    );
    const scan = findExpressRoutes(graph);
    expect(scan.routes).toEqual([]);
    expect(scan.skipped.map((s) => s.reason)).toEqual(['@GetMapping: caminho não literal']);
  });
});

describe('J3 — I/O do Java (Spring Data, JdbcTemplate, EntityManager, @Transactional, clientes HTTP)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const opsOf = (container: string, name: string, fileId: string) =>
    graph
      .callsOf(methodId(graph, container, name, fileId))
      .map((c) => ioOperationOf(c, fileId))
      .filter((o) => o !== undefined)
      .map((o) => `${o!.kind} ${o!.target} (${o!.via} · ${o!.operation ?? ''}${o!.lock ? ' · lock' : ''})`);

  it('Spring Data pelo nome do método (derivados inclusive), na entidade; `findAll().stream()` é uma leitura só; `@Transactional` abre transação', () => {
    indexFile(graph, fx, 'repo/OrderRepository.java', REPO);
    const f = indexFile(
      graph,
      fx,
      'Svc.java',
      `package com.acme.service;
import com.acme.model.Order;
import com.acme.repo.OrderRepository;
import org.springframework.transaction.annotation.Transactional;
public class Svc {
    private final OrderRepository repo;
    public Svc(OrderRepository repo) { this.repo = repo; }
    @Transactional
    public void run(Order o) {
        repo.findByStatus("x");
        repo.findAll().stream().count();
        repo.existsById(1L);
        repo.save(o);
        repo.deleteById(1L);
        repo.recalculateTotals();
    }
}
`
    );
    expect(opsOf('Svc', 'run', f)).toEqual([
      'db_tx transaction (jpa · startTransaction)',
      'db_read Order (springdata · findByStatus)',
      'db_read Order (springdata · findAll)',
      'db_read Order (springdata · existsById)',
      'db_write Order (springdata · save)',
      'db_write Order (springdata · deleteById)',
      'db_unknown Order (springdata · recalculateTotals)',
    ]);
  });

  it('JdbcTemplate e JdbcClient (SQL literal), EntityManager (find pela classe, persist, consulta nativa, transação)', () => {
    const f = indexFile(
      graph,
      fx,
      'Dao.java',
      `package com.acme;
import jakarta.persistence.EntityManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
public class Dao {
    private final JdbcTemplate jdbc;
    private final JdbcClient client;
    private final EntityManager em;
    public Dao(JdbcTemplate jdbc, JdbcClient client, EntityManager em) { this.jdbc = jdbc; this.client = client; this.em = em; }
    void run(Object order) {
        jdbc.queryForObject("SELECT quantity FROM stock WHERE product_id = ? FOR UPDATE", Integer.class, "p");
        jdbc.update("UPDATE stock SET quantity = quantity - 1 WHERE product_id = ?", "p");
        client.sql("SELECT * FROM orders WHERE id = :id").param("id", 1).query(Object.class).list();
        em.getTransaction().begin();
        em.find(Order.class, 1L);
        em.persist(order);
        em.createNativeQuery("DELETE FROM carts").executeUpdate();
        em.getTransaction().commit();
    }
}
`
    );
    expect(opsOf('Dao', 'run', f)).toEqual([
      'db_read stock (jdbctemplate · SELECT · lock)',
      'db_write stock (jdbctemplate · UPDATE)',
      'db_read orders (jdbctemplate · SELECT)',
      'db_tx transaction (jpa · startTransaction)',
      'db_read Order (jpa · find)',
      'db_write dynamic (jpa · persist)',
      'db_write carts (jpa · DELETE)',
      'db_tx transaction (jpa · commitTransaction)',
    ]);
  });

  it('RestTemplate (host da URL) e WebClient/RestClient (host do `.uri()` da cadeia, contado no `retrieve`)', () => {
    const f = indexFile(
      graph,
      fx,
      'Http.java',
      `package com.acme;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.client.RestClient;
import org.springframework.web.reactive.function.client.WebClient;
public class Http {
    private final RestTemplate rest;
    private final WebClient web;
    private final RestClient client;
    public Http(RestTemplate rest, WebClient web, RestClient client) { this.rest = rest; this.web = web; this.client = client; }
    void run() {
        rest.postForObject("https://api.stripe.com/v1/charges", null, String.class);
        web.post().uri("https://api.correios.com.br/frete").bodyValue("x").retrieve().bodyToMono(String.class);
        client.get().uri("/relativo").retrieve().body(String.class);
    }
}
`
    );
    expect(opsOf('Http', 'run', f)).toEqual([
      'api_call api.stripe.com (resttemplate · postForObject)',
      'api_call api.correios.com.br (webclient · retrieve)',
      'api_call dynamic (resttemplate · retrieve)',
    ]);
  });

  it('o exemplo pedidos-springboot: as mesmas tags do checkout-express e do pedidos-aspnet', async () => {
    const root = path.join(REPO_ROOT, 'examples', 'pedidos-springboot');
    await indexFiles(graph, await listSourceFiles(root), silentHost);
    const topology = buildTopology(graph, buildSystemGraph(graph, [], root), root);
    expect(topology.routes.map((r) => r.id).sort()).toEqual(['GET /api/orders/{id}', 'POST /api/checkout']);
    const checkout = topology.routes.find((r) => r.id === 'POST /api/checkout')!;
    expect(checkout.operations.map((o) => `${o.kind} ${o.target}`)).toEqual(['db_read StockItem', 'api_call api.stripe.com', 'db_write StockItem', 'db_write Order']);
    expect(checkout.tags).toEqual([
      { tag: 'external-io', targets: ['api.stripe.com'] },
      { tag: 'no-transaction', targets: ['StockItem'] },
      { tag: 'read-then-write', targets: ['StockItem'] },
      { tag: 'write-after-api-call', targets: ['Order', 'StockItem'] },
    ]);
    expect(checkout.confidence).toBe('proven');
    expect(graph.stats).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });
});

describe('J5 — o que os projetos Java reais pediram (`import static`, classe anônima, métodos de `Object`)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('`import static` de classe do projeto (provado) e de fora (nativo); double brace; `getClass()`', () => {
    const util = indexFile(graph, fx, 'util/Texts.java', 'package com.acme.util;\npublic final class Texts { public static String slug(String s) { return s; } }\n');
    const f = indexFile(
      graph,
      fx,
      'web/Api.java',
      `package com.acme.web;
import static com.acme.util.Texts.slug;
import static org.assertj.core.api.Assertions.assertThat;
import static java.util.stream.Collectors.*;
import java.util.HashMap;
public class Api {
    Object run(String s) {
        slug(s);
        assertThat(s);
        joining(",");
        getClass();
        return new HashMap<String, Object>() {{ put("a", 1); }};
    }
}
`
    );
    const run = methodId(graph, 'Api', 'run', f);
    expect(graph.callsOf(run).map((c) => [c.name, c.outcome])).toEqual([
      ['slug', 'resolved'],
      ['assertThat', 'unbound'],
      ['joining', 'unbound'],
      ['getClass', 'unbound'],
      ['put', 'unbound'],
      ['HashMap', 'unbound'],
    ]);
    expect(graph.callsOf(run)[0]!.targets).toEqual([methodId(graph, 'Texts', 'slug', util)]);
    expect(graph.fileCoverage(f)).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
  });
});
