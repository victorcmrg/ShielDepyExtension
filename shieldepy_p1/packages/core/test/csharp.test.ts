import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexFiles, isSymbolNode, listSourceFiles, packageNodeId, silentHost, toFileId, type CodeGraph, type SymbolNodeAttrs } from '../src/index';
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
    expect(names).toEqual(['class:Circle', 'class:Inner', 'class:OrderDto', 'class:Point', 'function:Sq', 'method:Circle.Area', 'method:Circle.Circle', 'method:Inner.Z']);
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
