import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeGraph, silentHost, toFileId } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRegistry } from '@shieldepy/extractors';
import { WorkspaceModel } from '../src/workspace/WorkspaceModel';
import { verifyProposedFix } from '../src/workspace/verify-fix';
import { resolveInsideWorkspace } from '../src/workspace/path-guard';

let dir: string;
let model: WorkspaceModel;

const write = (rel: string, content: string) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  model.updateFile(full, content);
  return full;
};

const PRICING = "import { bus } from '../bus';\nbus.on('order.updated', (o) => { o.total = o.subtotal * 0.9; });\n";
const TAX = "import { bus } from '../bus';\nbus.on('order.updated', (order) => {\n  const x = order;\n  x.total = x.subtotal * 1.1;\n});\n";
const AUDIT_JAVA = '@EventListener\npublic void on(OrderUpdated e) { e.setPrevTotal(e.getTotal()); }\n';

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-ws-'));
  model = new WorkspaceModel(await CodeGraph.create(defaultWasmDir(), silentHost), await loadRegistry(defaultWasmDir()), (p) => path.relative(dir, p));
});
afterEach(() => {
  model.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('WorkspaceModel — grafo estrutural + grafo de interações num parse só', () => {
  it('regras de TS vêm da árvore do CodeGraph (alias incluso) e colidem entre arquivos', () => {
    const pricing = write('pricing/handlers.ts', PRICING);
    write('tax/handlers.ts', TAX);

    expect(model.rules.map((r) => r.name).sort()).toEqual(['pricing/handlers (order.updated)', 'tax/handlers (order.updated)']);
    const [c] = model.collisions();
    expect(model.collisions().length).toBe(1);
    expect(c).toMatchObject({ type: 'write-write', field: 'total' });
    expect(model.collisionsInvolving(toFileId(pricing)).length).toBe(1);
    expect(model.rulesIn(toFileId(pricing))[0]!.location).toEqual({ file: toFileId(pricing), line: 1 });
  });

  it('Java entra pelo extrator regex e avisa quem escuta mudança de regras', () => {
    const listener = vi.fn();
    model.onDidChangeRules(listener);
    write('audit/Audit.java', AUDIT_JAVA);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(model.rules[0]).toMatchObject({ resource: 'Order', event: 'OrderUpdated', reads: ['total'], writes: ['prevTotal'] });

    write('audit/Audit.java', AUDIT_JAVA); // mesmo conteúdo → regras iguais → não notifica de novo
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('remover o arquivo remove as regras e desfaz a colisão', () => {
    write('pricing/handlers.ts', PRICING);
    const tax = write('tax/handlers.ts', TAX);
    model.removeFile(tax);
    expect(model.collisions()).toEqual([]);
  });

  it('debounce é POR ARQUIVO: editar A e depois B não descarta A (item 4.1)', () => {
    vi.useFakeTimers();
    try {
      const a = path.join(dir, 'a.ts');
      const b = path.join(dir, 'b.ts');
      model.scheduleUpdate(a, () => "bus.on('e.x', (p) => { p.f = 1; });", 800);
      vi.advanceTimersByTime(400);
      model.scheduleUpdate(b, () => "bus.on('e.x', (p) => { p.f = 2; });", 800);
      vi.advanceTimersByTime(800);
      expect(model.rules.length).toBe(2);
      expect(model.collisions().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('verifyProposedFix — numa cópia do modelo (item 2.3)', () => {
  it('acusa ciclo e colisão NOVOS criados pelo fix, sem tocar no modelo real', async () => {
    write('a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    const b = write('b.ts', 'export function b() {}\n');
    write('pricing/handlers.ts', PRICING);

    const proposed = "import { a } from './a';\nimport { bus } from './bus';\nexport function b() { a(); }\nbus.on('order.updated', (o) => { o.total = 0; });\n";
    const issues = await verifyProposedFix(model, b, proposed);

    expect(issues.some((i) => i.startsWith('ciclo de chamadas: b → a → b'))).toBe(true);
    expect(issues.some((i) => i.includes('colisão nova (write-write) no campo "total"'))).toBe(true);
    // o modelo real segue refletindo o arquivo em disco
    expect(model.graph.cyclesInFile(toFileId(b))).toEqual([]);
    expect(model.collisions()).toEqual([]);
  });

  it('colisão que JÁ existia antes do fix não conta como problema do fix', async () => {
    write('pricing/handlers.ts', PRICING);
    const tax = write('tax/handlers.ts', TAX);
    const scan = vi.fn(async () => [{ startLine: 0, endLine: 0, severity: 'info' as const, message: 'só info' }]);
    expect(await verifyProposedFix(model, tax, TAX + '\n// comentário\n', scan)).toEqual([]);
    expect(scan).toHaveBeenCalledOnce();
  });
});

describe('resolveInsideWorkspace (item 3.4)', () => {
  const root = path.resolve('/proj');
  it.each([
    ['relativo dentro', 'src/a.ts', path.join(root, 'src/a.ts')],
    ['absoluto dentro', path.join(root, 'b.ts'), path.join(root, 'b.ts')],
    ['sobe pra fora', '../.ssh/config', undefined],
    ['absoluto fora', path.resolve('/etc/passwd'), undefined],
    ['a própria raiz', '.', undefined],
    ['vazio', '  ', undefined],
  ])('%s', (_label, input, expected) => {
    expect(resolveInsideWorkspace(input, [root])).toBe(expected);
  });
});
