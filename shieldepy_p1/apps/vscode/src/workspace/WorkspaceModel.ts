import * as path from 'node:path';
import {
  buildGraph,
  collisionKey,
  collisionRuleIds,
  extOf,
  findCollisions,
  toFileId,
  type CodeGraph,
  type Collision,
  type Rule,
} from '@shieldepy/core';
import { extractEventHandlers, type ParsedRule, type Registry } from '@shieldepy/extractors';

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * O estado analisável do workspace — SEM `vscode` (testável direto):
 *   - o grafo estrutural (`CodeGraph`: imports, chamadas, ciclos)
 *   - as regras reativas de cada arquivo e as colisões entre elas (Grafo de Interações)
 * TS/JS é parseado UMA vez: a árvore do CodeGraph alimenta o extrator de regras via `onParsed`.
 */
export class WorkspaceModel {
  private rulesByFile = new Map<string, Rule[]>();
  private collisionsMemo: Collision[] | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingTsRules: { id: string; rules: ParsedRule[] } | undefined;

  constructor(
    readonly graph: CodeGraph,
    /** Registro de extratores SEM Tree-sitter — só pra Java/Python/C# e pro fallback de TS. */
    private readonly regexRegistry: Registry,
    /** Caminho relativo à raiz do workspace (dá nome legível às regras). */
    private readonly relative: (fsPath: string) => string = (p) => path.basename(p)
  ) {
    graph.onParsed(({ id, root }) => {
      this.pendingTsRules = { id, rules: extractEventHandlers(root) };
    });
  }

  /** Cópia independente pra simular um conteúdo proposto (verificação de fix) — item 2.3. */
  fork(): WorkspaceModel {
    const copy = new WorkspaceModel(this.graph.fork(), this.regexRegistry, this.relative);
    copy.rulesByFile = new Map(this.rulesByFile);
    return copy;
  }

  static handles(fsPath: string, registry: Registry): boolean {
    return registry.forPath(fsPath) !== undefined || ['.html', '.htm', '.css'].includes(extOf(fsPath));
  }

  /** Reindexa um arquivo agora (grafo + regras). Nunca lança. */
  updateFile(fsPath: string, text: string): void {
    const id = toFileId(fsPath);
    this.cancelScheduled(id);
    this.pendingTsRules = undefined;
    this.graph.updateFile(fsPath, text);

    let parsed = this.takeParsedRules(id);
    if (parsed === undefined && (!TS_EXTENSIONS.has(extOf(fsPath)) || !this.graph.isReady)) {
      try {
        parsed = this.regexRegistry.forPath(fsPath)?.parse(text, fsPath);
      } catch {
        parsed = undefined;
      }
    }
    if (parsed !== undefined) this.setRules(id, this.toRules(fsPath, id, parsed));
  }

  /** Regras que o `onParsed` capturou durante o `graph.updateFile` deste arquivo (se era TS/JS). */
  private takeParsedRules(id: string): ParsedRule[] | undefined {
    const pending = this.pendingTsRules;
    this.pendingTsRules = undefined;
    return pending?.id === id ? pending.rules : undefined;
  }

  /**
   * Debounce POR ARQUIVO (item 4.1): antes era um timer global — editar A e depois B em menos
   * de 800ms descartava a atualização de A.
   */
  scheduleUpdate(fsPath: string, getText: () => string, ms: number): void {
    const id = toFileId(fsPath);
    this.cancelScheduled(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.updateFile(fsPath, getText());
      }, ms)
    );
  }

  removeFile(fsPath: string): void {
    const id = toFileId(fsPath);
    this.cancelScheduled(id);
    this.graph.removeFile(fsPath);
    this.setRules(id, []);
    this.rulesByFile.delete(id);
  }

  get rules(): Rule[] {
    return [...this.rulesByFile.values()].flat();
  }

  rulesIn(fileId: string): Rule[] {
    return this.rulesByFile.get(fileId) ?? [];
  }

  /** Todas as colisões do workspace (memoizado até alguma regra mudar). */
  collisions(): Collision[] {
    this.collisionsMemo ??= findCollisions(buildGraph(this.rules));
    return this.collisionsMemo;
  }

  collisionsInvolving(fileId: string): Collision[] {
    const ids = new Set(this.rulesIn(fileId).map((r) => r.id));
    return this.collisions().filter((c) => collisionRuleIds(c).some((id) => ids.has(id)));
  }

  collisionKeys(fileId: string): Set<string> {
    return new Set(this.collisionsInvolving(fileId).map(collisionKey));
  }

  /** Disparado quando as regras (e portanto as colisões) mudam. */
  onDidChangeRules(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
    this.graph.dispose();
  }

  private cancelScheduled(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private setRules(id: string, rules: Rule[]): void {
    const before = JSON.stringify(this.rulesByFile.get(id) ?? []);
    if (rules.length === 0) this.rulesByFile.delete(id);
    else this.rulesByFile.set(id, rules);
    if (JSON.stringify(rules) === before) return;
    this.collisionsMemo = undefined;
    for (const listener of this.listeners) listener();
  }

  /**
   * Regras com id estável e legível: `services/pricing/handlers.ts:6:order.updated`. O "serviço"
   * é pasta/arquivo (`pricing/handlers`) — só o nome do arquivo repetiria `handlers` em todo lugar.
   */
  private toRules(fsPath: string, fileId: string, parsed: ParsedRule[]): Rule[] {
    const rel = this.relative(fsPath).replace(/\\/g, '/');
    const service = rel.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
    const seen = new Map<string, number>();
    return parsed.map((p) => {
      const base = `${rel}:${(p.line ?? 0) + 1}:${p.event}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        id: n === 1 ? base : `${base}#${n}`,
        name: `${service} (${p.event})`,
        resource: p.resource,
        event: p.event,
        reads: p.reads,
        writes: p.writes,
        source: service,
        location: { file: fileId, line: p.line ?? 0 },
      };
    });
  }
}
