import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemGraph, buildTopology, findExpressRoutes, indexFiles, ioOperationOf, isSymbolNode, listSourceFiles, packageNodeId, silentHost, toFileId, type CodeGraph, type SymbolNodeAttrs } from '../src/index';
import { createGraph, Fixture, indexFile, REPO_ROOT } from './helpers';

/** Id do método `name` da classe `container` no arquivo. */
function methodId(graph: CodeGraph, container: string, name: string, fileId: string, nth = 0): string {
  const ids = graph.ownedSymbols(fileId).filter((s) => {
    const a = graph.nodeAttributes(s);
    return a?.kind === 'method' && a.container === container && a.name === name;
  });
  if (!ids[nth]) throw new Error(`método ${container}.${name} não encontrado`);
  return ids[nth]!;
}

function classAttrs(graph: CodeGraph, name: string, fileId: string): SymbolNodeAttrs {
  for (const id of graph.ownedSymbols(fileId)) {
    const a = graph.nodeAttributes(id);
    if (a && isSymbolNode(a) && a.kind === 'class' && a.name === name) return a;
  }
  throw new Error(`classe ${name} não encontrada`);
}

const REPO_IFACE = `namespace App.Data;
public interface IOrderRepository { Order Find(int id); void Save(Order o); }
`;
const REPO_IMPL = `namespace App.Data;
public class OrderRepository : IOrderRepository
{
    public Order Find(int id) => null;
    public void Save(Order o) { }
}
public class Order { public int Id { get; set; } public void Validate() { } }
`;
const SERVICE = `using App.Data;
namespace App.Services;
public class OrderService
{
    private readonly IOrderRepository _repo;
    public OrderService(IOrderRepository repo) { _repo = repo; }
    public Order Create(int id)
    {
        var order = _repo.Find(id);
        order.Validate();
        _repo.Save(order);
        Audit();
        return order;
    }
    private void Audit() { }
}
`;

describe('L2 — C#: símbolos, namespaces e chamadas', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('classes, structs e records com namespace; métodos e construtores; interface e enum não viram símbolo', () => {
    const f = indexFile(
      graph,
      fx,
      'Models.cs',
      `namespace App.Models
{
    public interface IShape { double Area(); }
    public enum Kind { A, B }
    public record OrderDto(int Id, string Name);
    public struct Point { public int X; }
    public class Circle : IShape
    {
        public Circle(double r) { }
        public double Area() { double Sq(double x) => x * x; return Sq(2); }
        public class Inner { void Z() { } }
    }
}
`
    );
    const symbols = graph.ownedSymbols(f).map((id) => graph.nodeAttributes(id)).filter((a) => a && isSymbolNode(a)) as SymbolNodeAttrs[];
    const names = symbols.map((s) => `${s.kind}:${s.container ? s.container + '.' : ''}${s.name}`).sort();
    expect(names).toEqual(['class:Circle', 'class:Circle.Inner', 'class:OrderDto', 'class:Point', 'function:Sq', 'method:Circle.Area', 'method:Circle.Circle', 'method:Inner.Z']);
    expect(classAttrs(graph, 'Circle', f)).toMatchObject({ namespace: 'App.Models', implements: ['IShape'] });
    expect(classAttrs(graph, 'OrderDto', f).properties).toEqual(['Id', 'Name']);
  });

  it('`_repo.Save()` com campo de interface → a implementação, em outro arquivo e namespace (via `using`)', () => {
    indexFile(graph, fx, 'Data/IOrderRepository.cs', REPO_IFACE);
    const impl = indexFile(graph, fx, 'Data/OrderRepository.cs', REPO_IMPL);
    const svc = indexFile(graph, fx, 'Services/OrderService.cs', SERVICE);
    const create = methodId(graph, 'OrderService', 'Create', svc);
    expect(graph.hasEdge(create, methodId(graph, 'OrderRepository', 'Find', impl), 'calls')).toBe(true);
    expect(graph.hasEdge(create, methodId(graph, 'OrderRepository', 'Save', impl), 'calls')).toBe(true);
    // `var order = _repo.Find(id); order.Validate()`: o tipo de `order` vem do retorno de `Find`
    expect(graph.hasEdge(create, methodId(graph, 'Order', 'Validate', impl), 'calls')).toBe(true);
    // chamada sem receptor dentro da classe é `this.Audit()`
    expect(graph.hasEdge(create, methodId(graph, 'OrderService', 'Audit', svc), 'calls')).toBe(true);
    expect(graph.fileCoverage(svc)).toMatchObject({ callsResolved: 4, callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('a mesma classe num namespace que o arquivo NÃO enxerga não é ligada', () => {
    indexFile(graph, fx, 'Other.cs', 'namespace Other.Data;\npublic class OrderRepository : IOrderRepository { public void Save(Order o) { } }\n');
    const visible = indexFile(graph, fx, 'Data.cs', 'namespace App.Data;\npublic class Repo { public void Save() { } }\n');
    const svc = indexFile(graph, fx, 'Svc.cs', 'using App.Data;\nnamespace App.Services;\npublic class Svc { private Repo _r; public void Run() { _r.Save(); } }\n');
    const run = methodId(graph, 'Svc', 'Run', svc);
    expect(graph.hasEdge(run, methodId(graph, 'Repo', 'Save', visible), 'calls')).toBe(true);
    // `Repo` não está em `Other.Data`; e um `OrderRepository` de lá não entra por nome
    const out = graph.callsOf(run);
    expect(out.map((c) => c.targets).flat()).toEqual([methodId(graph, 'Repo', 'Save', visible)]);
  });

  it('namespace de cima sem `using`, alias de `using`, nome qualificado e `global using`', () => {
    const util = indexFile(graph, fx, 'Util.cs', 'namespace App.Util { public static class Fmt { public static string Do(string s) => s; } }\nnamespace App { public class Root { public static void Hi() { } } }\n');
    const lib = indexFile(graph, fx, 'Lib.cs', 'namespace Lib.Deep;\npublic class Tool { public static void Use() { } }\n');
    indexFile(graph, fx, 'Globals.cs', 'global using Lib.Deep;\n');
    const caller = indexFile(
      graph,
      fx,
      'Caller.cs',
      `using F = App.Util.Fmt;
namespace App.Web.Controllers;
public class C
{
    public void Run()
    {
        Root.Hi();              // App é namespace de cima de App.Web.Controllers
        F.Do("a");              // alias
        App.Util.Fmt.Do("b");   // qualificado
        Util.Fmt.Do("c");       // qualificado relativo a App
        Tool.Use();             // global using
    }
}
`
    );
    const run = methodId(graph, 'C', 'Run', caller);
    expect(graph.hasEdge(run, methodId(graph, 'Root', 'Hi', util), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'Fmt', 'Do', util), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'Tool', 'Use', lib), 'calls')).toBe(true);
    expect(graph.callsOf(run).map((c) => c.outcome)).toEqual(['resolved', 'resolved', 'resolved', 'resolved', 'resolved']);
  });

  it('`new X()` liga ao construtor (ou à classe, sem construtor); tipo de pacote é externo; nativo não conta', () => {
    const f = indexFile(
      graph,
      fx,
      'New.cs',
      `namespace App;
public class WithCtor { public WithCtor(int x) { } }
public class NoCtor { }
public class Factory
{
    public void Make()
    {
        var a = new WithCtor(1);
        var b = new NoCtor();
        var h = new HttpClient();
        var l = new List<int>();
    }
}
`
    );
    const make = methodId(graph, 'Factory', 'Make', f);
    const sites = graph.callsOf(make);
    expect(sites.map((s) => [s.name, s.outcome])).toEqual([
      ['WithCtor', 'resolved'],
      ['NoCtor', 'resolved'],
      ['HttpClient', 'external'],
      ['List', 'unbound'],
    ]);
    expect(sites[0]!.targets).toEqual([methodId(graph, 'WithCtor', 'WithCtor', f)]);
    expect(graph.nodeAttributes(sites[1]!.targets[0]!)).toMatchObject({ kind: 'class', name: 'NoCtor' });
    expect(sites[2]!.package).toBe('System.Net.Http');
    expect(graph.fileCoverage(f)).toMatchObject({ callsResolved: 2, callsExternal: 1, callsUnresolved: 0 });
  });

  it('herança: método da base (em outro arquivo) e base de pacote; a 1ª base sendo interface não puxa as irmãs', () => {
    const base = indexFile(graph, fx, 'Base.cs', 'namespace App;\npublic abstract class BaseService { protected void Log() { } }\n');
    const f = indexFile(
      graph,
      fx,
      'Svcs.cs',
      `using Microsoft.AspNetCore.Mvc;
namespace App;
public interface IJob { void Run(); }
public class JobA : IJob { public void Run() { Helper(); } }
public class JobB : IJob { public void Run() { } public void Helper() { } }
public class Svc : BaseService { public void Go() { Log(); base.Log(); } }
public class OrdersController : ControllerBase { public object Get() { return Ok(1); } }
`
    );
    expect(graph.hasEdge(methodId(graph, 'Svc', 'Go', f), methodId(graph, 'BaseService', 'Log', base), 'calls')).toBe(true);
    // `Helper()` em JobA: não existe na própria classe nem em base; não pode cair no `Helper` da irmã JobB
    const runA = methodId(graph, 'JobA', 'Run', f);
    expect(graph.callsOf(runA)[0]).toMatchObject({ name: 'Helper', outcome: 'unresolved', targets: [] });
    // `Ok()` herdado de `ControllerBase` (ASP.NET): externo
    expect(graph.callsOf(methodId(graph, 'OrdersController', 'Get', f))[0]).toMatchObject({ name: 'Ok', outcome: 'external', package: 'Microsoft.AspNetCore.Mvc' });
    expect(graph.hasEdge(f, packageNodeId('Microsoft.AspNetCore.Mvc'), 'imports')).toBe(true);
  });

  it('o mapa não depende da ordem de indexação, e religa quando a classe chamada muda ou some', async () => {
    const files: Array<[string, string]> = [
      ['Services/OrderService.cs', SERVICE],
      ['Data/OrderRepository.cs', REPO_IMPL],
      ['Data/IOrderRepository.cs', REPO_IFACE],
    ];
    const edges = (g: CodeGraph) =>
      g
        .toSnapshot()
        .edges.map((e) => `${e.source}->${e.attributes.type}${e.attributes.heuristic ? '?' : ''}->${e.target}`)
        .sort();
    for (const [rel, text] of files) indexFile(graph, fx, rel, text);
    const forward = edges(graph);
    const other = await createGraph();
    for (const [rel, text] of [...files].reverse()) indexFile(other, fx, rel, text);
    expect(edges(other)).toEqual(forward);

    // a classe `Order` é renomeada: o retorno de `Find` (`Order`) deixa de ser classe do projeto
    const svc = indexFile(graph, fx, 'Services/OrderService.cs', SERVICE);
    indexFile(graph, fx, 'Data/OrderRepository.cs', REPO_IMPL.replace('public class Order {', 'public class Pedido {'));
    const create = methodId(graph, 'OrderService', 'Create', svc);
    expect(graph.callsOf(create).find((c) => c.name === 'Validate')?.targets).toEqual([]);
    // volta: religa
    const impl = indexFile(graph, fx, 'Data/OrderRepository.cs', REPO_IMPL);
    expect(graph.hasEdge(create, methodId(graph, 'Order', 'Validate', impl), 'calls')).toBe(true);
    // some: a ligação sai
    graph.removeFile(fx.path('Data/OrderRepository.cs'));
    expect(graph.callsOf(create).find((c) => c.name === 'Save')?.targets).toEqual([]);
  });

  it('classe estática que muda de namespace: quem a chamava pelo `using` religa (só pelo índice de tipos)', () => {
    const caller = indexFile(graph, fx, 'Caller.cs', 'using App.Util;\nnamespace App.Web;\npublic class C { public void Run() { Fmt.Do(); } }\n');
    const util = indexFile(graph, fx, 'Fmt.cs', 'namespace App.Util;\npublic static class Fmt { public static void Do() { } }\n');
    const run = methodId(graph, 'C', 'Run', caller);
    expect(graph.hasEdge(run, methodId(graph, 'Fmt', 'Do', util), 'calls')).toBe(true);
    indexFile(graph, fx, 'Fmt.cs', 'namespace Other;\npublic static class Fmt { public static void Do() { } }\n');
    expect(graph.callsOf(run)[0]?.targets).toEqual([]);
    indexFile(graph, fx, 'Fmt.cs', 'namespace App.Util;\npublic static class Fmt { public static void Do() { } }\n');
    expect(graph.hasEdge(run, methodId(graph, 'Fmt', 'Do', util), 'calls')).toBe(true);
  });

  it('`global using` novo religa os arquivos que já estavam no mapa', () => {
    const lib = indexFile(graph, fx, 'Lib.cs', 'namespace Lib;\npublic class Tool { public static void Use() { } }\n');
    const f = indexFile(graph, fx, 'Use.cs', 'namespace App;\npublic class U { public void Run() { Tool.Use(); } }\n');
    const run = methodId(graph, 'U', 'Run', f);
    expect(graph.hasEdge(run, methodId(graph, 'Tool', 'Use', lib), 'calls')).toBe(false);
    indexFile(graph, fx, 'GlobalUsings.cs', 'global using Lib;\n');
    expect(graph.hasEdge(run, methodId(graph, 'Tool', 'Use', lib), 'calls')).toBe(true);
  });

  it('C# moderno: construtor primário (C# 12) e lambda com tipo de retorno (C# 10)', () => {
    const f = indexFile(
      graph,
      fx,
      'Modern.cs',
      `namespace App;
public class Repo { public Task<int> CountAsync() => Task.FromResult(1); }
public class Svc(Repo repo)
{
    private readonly Repo _copy = repo;
    public Task<int> Run() => repo.CountAsync();
    public Task<int> Copy() => _copy.CountAsync();
}
public static class Endpoints
{
    public static void Map(IEndpointRouteBuilder routes)
    {
        routes.MapGet("/count", async Task<int> (Repo r) => await r.CountAsync());
    }
}
`
    );
    const count = methodId(graph, 'Repo', 'CountAsync', f);
    expect(graph.hasEdge(methodId(graph, 'Svc', 'Run', f), count, 'calls')).toBe(true);
    expect(graph.hasEdge(methodId(graph, 'Svc', 'Copy', f), count, 'calls')).toBe(true);
    // o handler com tipo de retorno vira símbolo e chega no repositório; a rota aparece
    expect(findExpressRoutes(graph).routes.map((r) => r.id)).toEqual(['GET /count']);
    const handler = findExpressRoutes(graph).routes[0]!.handlers[0]!.symbols[0]!;
    expect(graph.hasEdge(handler, count, 'calls')).toBe(true);
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('métodos de extensão do projeto: na classe, pela interface e num tipo de fora declarado — mas não roubam o EF Core', () => {
    const ext = indexFile(
      graph,
      fx,
      'Ext.cs',
      `namespace App;
public static class OrderExtensions
{
    public static string ToDto(this Order o) => "";
    public static int Total(this IPriced p) => 0;
    public static int Sum(this List<Order> list) => 0;
    public static void Add(this HashSet<Order> set, Order o) { }
}
`
    );
    const f = indexFile(
      graph,
      fx,
      'Use.cs',
      `using Microsoft.EntityFrameworkCore;
namespace App;
public interface IPriced { }
public class Order : IPriced { }
public class Db : DbContext { public DbSet<Order> Orders { get; set; } }
public class U
{
    private readonly Db _db;
    private readonly List<Order> _all;
    public void Run(Order o, IPriced p)
    {
        o.ToDto();
        p.Total();
        _all.Sum();
        _db.Orders.Add(o);
    }
}
`
    );
    const sites = graph.callsOf(methodId(graph, 'U', 'Run', f));
    expect(sites.map((c) => [c.name, c.outcome])).toEqual([
      ['ToDto', 'resolved'],
      ['Total', 'resolved'],
      ['Sum', 'resolved'],
      ['Add', 'external'],
    ]);
    expect(sites[0]!.targets).toEqual([methodId(graph, 'OrderExtensions', 'ToDto', ext)]);
    expect(sites[2]!.targets).toEqual([methodId(graph, 'OrderExtensions', 'Sum', ext)]);
    expect(sites[3]!.package).toBe('Microsoft.EntityFrameworkCore');
    // o método de extensão sai: a ligação também (religa pelo nome do método)
    indexFile(graph, fx, 'Ext.cs', 'namespace App;\npublic static class OrderExtensions { }\n');
    expect(graph.callsOf(methodId(graph, 'U', 'Run', f))[0]).toMatchObject({ name: 'ToDto', outcome: 'unresolved' });
  });

  it('variáveis locais com tipo, `var` de `new`, lambda tipada, delegate e `nameof` (que não é chamada)', () => {
    const f = indexFile(
      graph,
      fx,
      'Locals.cs',
      `namespace App;
public class Repo { public void Save() { } }
public class L
{
    private Func<int> _make;
    public void Run(Repo p)
    {
        Repo typed = null;
        typed.Save();
        var made = new Repo();
        made.Save();
        p.Save();
        Action<Repo> f = (Repo r) => r.Save();
        _make();
        var n = nameof(Run);
        string s = "x";
        s.Trim();
    }
}
`
    );
    const run = methodId(graph, 'L', 'Run', f);
    const save = methodId(graph, 'Repo', 'Save', f);
    const sites = graph.callsOf(run).filter((c) => c.name === 'Save');
    expect(sites).toHaveLength(4);
    expect(sites.every((c) => c.outcome === 'resolved' && c.targets[0] === save)).toBe(true);
    expect(graph.callsOf(run).map((c) => c.name)).not.toContain('nameof');
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });
});

describe('L2 — o exemplo examples/pedidos-aspnet', () => {
  it('controller → serviço → repositórios → EF Core e gateway → HttpClient, tudo provado', async () => {
    const graph = await createGraph();
    const root = path.join(REPO_ROOT, 'examples', 'pedidos-aspnet');
    await indexFiles(graph, await listSourceFiles(root), silentHost);
    const file = (rel: string) => toFileId(path.join(root, rel));
    const checkout = methodId(graph, 'CheckoutService', 'CheckoutAsync', file('Services/CheckoutService.cs'));
    const sites = graph.callsOf(checkout);
    expect(sites.map((c) => [c.name, c.outcome])).toEqual([
      ['AvailableAsync', 'resolved'],
      ['OutOfStockException', 'resolved'],
      ['ChargeAsync', 'resolved'],
      ['DecrementAsync', 'resolved'],
      ['Order', 'resolved'],
      ['InsertAsync', 'resolved'],
    ]);
    // a interface `IPaymentGateway` cai na implementação
    expect(sites[2]!.targets).toEqual([methodId(graph, 'StripeGateway', 'ChargeAsync', file('Gateways/StripeGateway.cs'))]);
    // EF Core: o pacote e a entidade do `DbSet<T>`
    const insert = graph.callsOf(methodId(graph, 'OrderRepository', 'InsertAsync', file('Data/OrderRepository.cs')));
    expect(insert.map((c) => [c.name, c.package, c.model])).toEqual([
      ['Add', 'Microsoft.EntityFrameworkCore', 'Order'],
      ['SaveChangesAsync', 'Microsoft.EntityFrameworkCore', undefined],
    ]);
    const available = graph.callsOf(methodId(graph, 'StockRepository', 'AvailableAsync', file('Data/StockRepository.cs')));
    expect(available[0]).toMatchObject({ name: 'FirstOrDefaultAsync', package: 'Microsoft.EntityFrameworkCore', model: 'StockItem' });
    const charge = graph.callsOf(methodId(graph, 'StripeGateway', 'ChargeAsync', file('Gateways/StripeGateway.cs')));
    expect(charge.find((c) => c.name === 'PostAsync')).toMatchObject({ outcome: 'external', package: 'System.Net.Http', args: [{ kind: 'string', value: 'https://api.stripe.com/v1/charges' }, expect.anything()] });
    expect(graph.stats).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });
});

describe('L3 — rotas do ASP.NET Core', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const routesOf = () => findExpressRoutes(graph);
  const summary = () =>
    routesOf()
      .routes.map((r) => `${r.id} → ${r.handlers.map((h) => h.label).join(', ')}`)
      .sort();

  it('controllers: `[Route]` na classe com `[controller]`, verbos com e sem template, `/` absoluto, `[Route]` no método e `[action]`', () => {
    indexFile(
      graph,
      fx,
      'OrdersController.cs',
      `using Microsoft.AspNetCore.Mvc;
namespace App.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();

    [HttpGet("{id:int}")]
    public IActionResult Get(int id) => Ok();

    [HttpPost("/checkout")]
    public IActionResult Checkout() => Ok();

    [HttpPut]
    [Route("{id}/status")]
    public IActionResult SetStatus(int id) => Ok();

    [Route("[action]")]
    public async Task<IActionResult> ExportAsync() => Ok();
}

public class HealthController : ControllerBase
{
    [HttpGet("health")]
    public IActionResult Ping() => Ok();
}

[Route("v1/items")]
[Route("v2/items")]
public class ItemsController : Controller
{
    [HttpDelete("{id}")]
    public IActionResult Remove(int id) => Ok();
}
`
    );
    expect(summary()).toEqual([
      'ALL /api/Orders/Export → OrdersController.ExportAsync',
      'DELETE /v1/items/{id} → ItemsController.Remove',
      'DELETE /v2/items/{id} → ItemsController.Remove',
      'GET /api/Orders → OrdersController.List',
      'GET /api/Orders/{id:int} → OrdersController.Get',
      'GET /health → HealthController.Ping',
      'POST /checkout → OrdersController.Checkout',
      'PUT /api/Orders/{id}/status → OrdersController.SetStatus',
    ]);
  });

  it('um atributo `HttpGet` do próprio projeto não é rota (não resolve para o ASP.NET Core)', () => {
    indexFile(
      graph,
      fx,
      'Fake.cs',
      `namespace App;
public class HttpGet : System.Attribute { public HttpGet(string t) { } }
public class C { [HttpGet("x")] public void M() { } }
`
    );
    expect(routesOf().routes).toEqual([]);
  });

  it('minimal APIs: `MapGet` no app, grupos aninhados, cadeia, grupo de métodos, extensão com `IEndpointRouteBuilder` e caminho não literal', () => {
    const handlers = indexFile(graph, fx, 'Handlers.cs', 'namespace App;\npublic static class Handlers { public static string Create(int x) => ""; }\n');
    indexFile(
      graph,
      fx,
      'Program.cs',
      `using App;
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/ping", () => "pong");
var api = app.MapGroup("/api");
var v1 = api.MapGroup("v1");
v1.MapPost("/orders", Handlers.Create);
app.MapGroup("/admin").MapDelete("/users/{id}", (int id) => id);
var dynamicPath = "/x";
app.MapGet(dynamicPath, () => 1);
app.Run();
`
    );
    indexFile(
      graph,
      fx,
      'Endpoints.cs',
      `namespace App;
public static class Endpoints
{
    public static void MapReports(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/reports", () => "r");
    }
}
`
    );
    expect(summary()).toEqual([
      'DELETE /admin/users/{id} → <inline>',
      'GET /ping → <inline>',
      'GET /reports → <inline>',
      'POST /api/v1/orders → Handlers.Create',
    ]);
    const post = routesOf().routes.find((r) => r.method === 'POST')!;
    expect(post.handlers[0]!.symbols).toEqual([methodId(graph, 'Handlers', 'Create', handlers)]);
    expect(routesOf().skipped.map((s) => s.reason)).toEqual(['MapGet: caminho não literal']);
  });

  it('o exemplo pedidos-aspnet: `POST /api/Checkout` (controller) e `GET /api/orders/{id}` (minimal API)', async () => {
    const root = path.join(REPO_ROOT, 'examples', 'pedidos-aspnet');
    await indexFiles(graph, await listSourceFiles(root), silentHost);
    expect(summary()).toEqual(['GET /api/orders/{id} → <inline>', 'POST /api/Checkout → CheckoutController.Create']);
  });
});

describe('L4 — I/O do C# (EF Core, Dapper, HttpClient)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  /** As operações de I/O de um método, na ordem, como `tipo alvo (via · operação)`. */
  const opsOf = (container: string, name: string, fileId: string) =>
    graph
      .callsOf(methodId(graph, container, name, fileId))
      .map((c) => ioOperationOf(c, fileId))
      .filter((o) => o !== undefined)
      .map((o) => `${o!.kind} ${o!.target} (${o!.via} · ${o!.operation ?? ''}${o!.lock ? ' · lock' : ''}${o!.timeout ? ' · timeout ' + o!.timeout : ''})`);

  const CONTEXT = `using Microsoft.EntityFrameworkCore;
namespace App.Data;
public class Order { public int Id { get; set; } }
public class Stock { public int Qty { get; set; } }
public class Db : DbContext
{
    public DbSet<Order> Orders { get; set; }
    public DbSet<Stock> Stock => Set<Stock>();
}
`;

  it('EF Core: só o que materializa é leitura; Add/Update/Remove e ExecuteDelete são escrita da entidade; SaveChanges e transação', () => {
    indexFile(graph, fx, 'Db.cs', CONTEXT);
    const repo = indexFile(
      graph,
      fx,
      'Repo.cs',
      `using Microsoft.EntityFrameworkCore;
namespace App.Data;
public class Repo
{
    private readonly Db _db;
    public Repo(Db db) { _db = db; }
    public async Task Run(int id)
    {
        using var tx = await _db.Database.BeginTransactionAsync();
        var list = await _db.Orders.Where(o => o.Id > id).OrderBy(o => o.Id).ToListAsync();
        var one = await _db.Orders.FindAsync(id);
        _db.Stock.Update(new Stock());
        _db.Orders.Remove(one!);
        await _db.Orders.Where(o => o.Id == 0).ExecuteDeleteAsync();
        await _db.SaveChangesAsync();
        await tx.CommitAsync();
    }
    public async Task Raw()
    {
        await _db.Stock.FromSqlRaw("SELECT * FROM stock WHERE id = {0} FOR UPDATE", 1).ToListAsync();
        await _db.Database.ExecuteSqlRawAsync("UPDATE stock SET qty = qty - 1");
    }
}
`
    );
    expect(opsOf('Repo', 'Run', repo)).toEqual([
      'db_tx transaction (efcore · startTransaction)',
      'db_read Order (efcore · ToListAsync)',
      'db_read Order (efcore · FindAsync)',
      'db_write Stock (efcore · Update)',
      'db_write Order (efcore · Remove)',
      'db_write Order (efcore · ExecuteDeleteAsync)',
      'db_tx transaction (efcore · SaveChanges)',
      'db_tx transaction (efcore · commitTransaction)',
    ]);
    expect(opsOf('Repo', 'Raw', repo)).toEqual(['db_read stock (efcore · SELECT · lock)', 'db_write stock (efcore · UPDATE)']);
  });

  it('Dapper numa conexão ADO.NET (SQL literal classificado) e HttpClient (host da URL, inclusive pelo IHttpClientFactory)', () => {
    const f = indexFile(
      graph,
      fx,
      'Io.cs',
      `using System.Data;
using Dapper;
using Npgsql;
namespace App;
public class Io
{
    private readonly IDbConnection _conn;
    private readonly HttpClient _http;
    private readonly IHttpClientFactory _factory;
    public Io(IDbConnection conn, HttpClient http, IHttpClientFactory factory) { _conn = conn; _http = http; _factory = factory; }
    public async Task Sql(int id)
    {
        await _conn.QueryFirstOrDefaultAsync<int>("SELECT qty FROM stock WHERE product_id = @id", new { id });
        await _conn.ExecuteAsync("UPDATE stock SET qty = qty - 1 WHERE product_id = @id", new { id });
        await using var conn = new NpgsqlConnection("x");
        await conn.ExecuteAsync(GetSql());
    }
    public async Task Http(string token)
    {
        await _http.PostAsJsonAsync("https://api.stripe.com/v1/charges", new { token });
        var client = _factory.CreateClient("correios");
        await client.GetFromJsonAsync<object>($"https://api.correios.com.br/frete/{token}");
        var res = await _http.GetAsync("/relativo");
        await res.Content.ReadAsStringAsync();
    }
    private string GetSql() => "";
}
`
    );
    expect(opsOf('Io', 'Sql', f)).toEqual([
      'db_read stock (dapper · SELECT)',
      'db_write stock (dapper · UPDATE)',
      'db_unknown dynamic (dapper · ExecuteAsync)',
    ]);
    expect(opsOf('Io', 'Http', f)).toEqual([
      'api_call api.stripe.com (httpclient · PostAsJsonAsync · timeout unknown)',
      'api_call api.correios.com.br (httpclient · GetFromJsonAsync · timeout unknown)',
      'api_call dynamic (httpclient · GetAsync · timeout unknown)',
    ]);
  });

  it('o exemplo pedidos-aspnet: as mesmas tags do checkout-express (corrida no estoque e falha parcial depois do Stripe)', async () => {
    const root = path.join(REPO_ROOT, 'examples', 'pedidos-aspnet');
    await indexFiles(graph, await listSourceFiles(root), silentHost);
    const system = buildSystemGraph(graph, [], root);
    const topology = buildTopology(graph, system, root);
    const checkout = topology.routes.find((r) => r.id === 'POST /api/Checkout')!;
    expect(checkout.operations.map((o) => `${o.kind} ${o.target}`)).toEqual([
      'db_read StockItem',
      'api_call api.stripe.com',
      'db_read StockItem',
      'db_write StockItem',
      'db_tx transaction',
      'db_write Order',
      'db_tx transaction',
    ]);
    expect(checkout.tags).toEqual([
      { tag: 'external-io', targets: ['api.stripe.com'] },
      { tag: 'no-transaction', targets: ['StockItem'] },
      { tag: 'read-then-write', targets: ['StockItem'] },
      { tag: 'write-after-api-call', targets: ['Order', 'StockItem'] },
    ]);
    expect(checkout.confidence).toBe('proven');
    expect(topology.routes.find((r) => r.id === 'GET /api/orders/{id}')!.operations.map((o) => `${o.kind} ${o.target}`)).toEqual(['db_read Order']);
  });
});

describe('L5 — o que os projetos C# reais pediram (MediatR, Ardalis.Specification, FastEndpoints, genéricos da BCL)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  /** `Create.Command` e o handler dele, num namespace por feature (o padrão do realworld). */
  const feature = (ns: string, table: string) => `using MediatR;
using Microsoft.EntityFrameworkCore;
namespace App.Features.${ns};
public class Create
{
    public record Command(string Name) : IRequest<int>;
    public class Handler : IRequestHandler<Command, int>
    {
        private readonly Db _db;
        public Handler(Db db) { _db = db; }
        public async Task<int> Handle(Command message, CancellationToken ct)
        {
            _db.${table}.Add(new App.${table.slice(0, -1)}());
            return await _db.SaveChangesAsync(ct);
        }
    }
}
`;

  it('MediatR: `Send(new Create.Command())` e `Send(command)` vão ao `Handle` de quem trata ESSA mensagem (não a homônima de outra feature)', () => {
    indexFile(graph, fx, 'Db.cs', 'using Microsoft.EntityFrameworkCore;\nnamespace App;\npublic class Article { }\npublic class Comment { }\npublic class Db : DbContext { public DbSet<Article> Articles { get; set; } public DbSet<Comment> Comments { get; set; } }\n');
    const articles = indexFile(graph, fx, 'Features/Articles/Create.cs', feature('Articles', 'Articles'));
    indexFile(graph, fx, 'Features/Comments/Create.cs', feature('Comments', 'Comments'));
    const ctrl = indexFile(
      graph,
      fx,
      'Features/Articles/ArticlesController.cs',
      `using MediatR;
using Microsoft.AspNetCore.Mvc;
namespace App.Features.Articles;
[Route("articles")]
public class ArticlesController : ControllerBase
{
    private readonly IMediator _mediator;
    public ArticlesController(IMediator mediator) { _mediator = mediator; }
    [HttpPost]
    public Task<int> Create([FromBody] Create.Command command) => _mediator.Send(command);
    [HttpPut]
    public Task<int> Again() => _mediator.Send(new Create.Command("x"));
}
`
    );
    const handle = methodId(graph, 'Handler', 'Handle', articles);
    for (const action of ['Create', 'Again']) {
      const site = graph.callsOf(methodId(graph, 'ArticlesController', action, ctrl)).find((c) => c.name === 'Send')!;
      expect(site).toMatchObject({ name: 'Send', outcome: 'resolved', targets: [handle] });
    }
    // e a rota chega ao banco pelo handler certo (Article, não Comment)
    const topology = buildTopology(graph, buildSystemGraph(graph, [], fx.dir), fx.dir);
    expect(topology.routes.find((r) => r.id === 'POST /articles')!.operations.map((o) => `${o.kind} ${o.target}`)).toEqual(['db_write Article', 'db_tx transaction']);
  });

  it('Ardalis.Specification: o repositório genérico vai ao banco, na entidade do `IRepository<T>` injetado', () => {
    indexFile(
      graph,
      fx,
      'Infra.cs',
      `using Ardalis.Specification.EntityFrameworkCore;
namespace App;
public interface IRepository<T> : IRepositoryBase<T> where T : class { }
public class EfRepository<T> : RepositoryBase<T>, IRepository<T> where T : class { public EfRepository(Db db) : base(db) { } }
public class Basket { }
`
    );
    const svc = indexFile(
      graph,
      fx,
      'BasketService.cs',
      `namespace App;
public class BasketService(IRepository<Basket> baskets)
{
    public async Task Run(int id)
    {
        var b = await baskets.GetByIdAsync(id);
        await baskets.UpdateAsync(b!);
    }
}
`
    );
    const ops = graph
      .callsOf(methodId(graph, 'BasketService', 'Run', svc))
      .map((c) => ioOperationOf(c, svc))
      .filter((o) => o)
      .map((o) => `${o!.kind} ${o!.target} (${o!.operation})`);
    expect(ops).toEqual(['db_read Basket (GetByIdAsync)', 'db_write Basket (UpdateAsync)']);
  });

  it('FastEndpoints: `Get("api/x")` no `Configure()` de `X : Endpoint<Req, Res>` é rota, com o `ExecuteAsync` como handler', () => {
    const f = indexFile(
      graph,
      fx,
      'GetItem.cs',
      `using FastEndpoints;
namespace App;
public class GetItem : Endpoint<Req, Res>
{
    public override void Configure() { Get("api/items/{id}", "api/v2/items/{id}"); AllowAnonymous(); }
    public override Task<Res> ExecuteAsync(Req r, CancellationToken ct) => Task.FromResult(new Res());
}
`
    );
    const routes = findExpressRoutes(graph).routes;
    expect(routes.map((r) => r.id)).toEqual(['GET /api/items/{id}', 'GET /api/v2/items/{id}']);
    expect(routes[0]!.handlers[0]!.symbols).toEqual([methodId(graph, 'GetItem', 'ExecuteAsync', f)]);
  });

  it('genérico da BCL não é a classe homônima do projeto, e campo de tipo nativo num DbContext não é do EF Core', () => {
    const f = indexFile(
      graph,
      fx,
      'Gen.cs',
      `using Microsoft.EntityFrameworkCore;
namespace App;
public class List { public void Add(int x) { } }
public class Ctx : DbContext
{
    private static readonly string[] Fields = ["a"];
    public string? Find(string s) => Fields.FirstOrDefault(f => f == s);
}
public class U { public void Run() { var tags = new List<string>(); tags.Add("x"); } }
`
    );
    expect(graph.callsOf(methodId(graph, 'U', 'Run', f)).map((c) => [c.name, c.outcome])).toEqual([
      ['List', 'unbound'],
      ['Add', 'unbound'],
    ]);
    expect(graph.callsOf(methodId(graph, 'Ctx', 'Find', f))[0]).toMatchObject({ name: 'FirstOrDefault', outcome: 'unbound' });
  });
});
