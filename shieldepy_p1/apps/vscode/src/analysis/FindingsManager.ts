import * as vscode from 'vscode';
import { toFileId, type Finding, type FindingSeverity } from '@shieldepy/core';
import type { FindingsCache, StoredFinding } from './FindingsCache';

/**
 * Grupos de achados de um arquivo, atualizados por produtores diferentes:
 *   - analysis : ciclos/HTML (grafo) + riscos da IA — recalculado quando ESTE arquivo muda
 *   - colisao  : colisões do Grafo de Interações — recalculado quando QUALQUER regra do workspace muda
 */
export type FindingGroup = 'analysis' | 'colisao';

const SOURCE_LABEL: Record<Finding['source'], string> = {
  grafo: 'ShielDepy (grafo)',
  colisao: 'ShielDepy (colisão)',
  ia: 'ShielDepy (IA)',
};

/**
 * Dona única do estado de "problemas encontrados" por arquivo. Cada `set` vira, ao mesmo tempo:
 *   1. um #id estável (via FindingsCache) citável no chat
 *   2. `vscode.Diagnostic` (painel Problems + sublinhado), com a outra ponta da colisão em relatedInformation
 *   3. marca-texto por severidade com hover
 *   4. um evento que a sidebar escuta
 */
export class FindingsManager implements vscode.Disposable {
  private readonly groups = new Map<string, Map<FindingGroup, Finding[]>>();
  private readonly store = new Map<string, StoredFinding[]>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('shieldepy');
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly decorationTypes: Record<FindingSeverity, vscode.TextEditorDecorationType> = {
    error: this.decoration('248, 81, 73'),
    warning: this.decoration('234, 179, 8'),
    info: this.decoration('63, 185, 80'),
  };
  private readonly visibleEditorsListener: vscode.Disposable;

  constructor(private readonly cache: FindingsCache) {
    this.visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) this.applyDecorations(editor);
    });
  }

  set(fileId: string, group: FindingGroup, findings: Finding[]): void {
    const byGroup = this.groups.get(fileId) ?? new Map<FindingGroup, Finding[]>();
    byGroup.set(group, findings);
    this.groups.set(fileId, byGroup);
    this.publish(fileId);
  }

  get(fileId: string): StoredFinding[] {
    return this.store.get(fileId) ?? [];
  }

  /** Só os achados de um grupo (ex.: reaproveitar os da IA na próxima passada incremental). */
  getGroup(fileId: string, group: FindingGroup): Finding[] {
    return this.groups.get(fileId)?.get(group) ?? [];
  }

  /** Acha pelo #id em QUALQUER arquivo já visto — o chat entende "o erro #a1b2c3" sem o arquivo em foco. */
  getById(id: string): StoredFinding | undefined {
    return this.cache.get(id);
  }

  getAllByFile(): Array<{ fileId: string; findings: StoredFinding[] }> {
    return [...this.store].filter(([, f]) => f.length > 0).map(([fileId, findings]) => ({ fileId, findings }));
  }

  /** Arquivo fechado/deletado: some a análise dele. Colisões só somem quando as regras somem. */
  clear(fileId: string, group?: FindingGroup): void {
    const byGroup = this.groups.get(fileId);
    if (!byGroup) return;
    if (group) byGroup.delete(group);
    else byGroup.clear();
    this.publish(fileId);
  }

  dispose(): void {
    this.diagnostics.dispose();
    this.visibleEditorsListener.dispose();
    this.changeEmitter.dispose();
    for (const type of Object.values(this.decorationTypes)) type.dispose();
  }

  private publish(fileId: string): void {
    const merged = [...(this.groups.get(fileId)?.values() ?? [])].flat();
    const uri = vscode.Uri.file(fileId);
    if (merged.length === 0) {
      this.groups.delete(fileId);
      this.store.delete(fileId);
      this.diagnostics.delete(uri);
    } else {
      const stored = this.cache.record(fileId, merged);
      this.store.set(fileId, stored);
      this.diagnostics.set(uri, stored.map((f) => this.toDiagnostic(f)));
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (sameFile(editor.document.uri, fileId)) this.applyDecorations(editor);
    }
    this.changeEmitter.fire(fileId);
  }

  private static readonly SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, error: 2 };
  private static readonly SEVERITY_BUMP: Record<FindingSeverity, FindingSeverity> = { info: 'warning', warning: 'error', error: 'error' };

  /**
   * Resolve por linha: só a severidade mais grave pinta o fundo (duas cores sobrepostas ficavam
   * ilegíveis); 2+ achados no mesmo nível sobem um degrau. Problems e sidebar continuam individuais.
   */
  private applyDecorations(editor: vscode.TextEditor): void {
    const findings = editor.document.uri.scheme === 'file' ? this.get(toFileId(editor.document.uri.fsPath)) : [];
    const bySeverity: Record<FindingSeverity, vscode.DecorationOptions[]> = { error: [], warning: [], info: [] };

    const byLine = new Map<number, StoredFinding[]>();
    for (const f of findings) byLine.set(f.startLine, [...(byLine.get(f.startLine) ?? []), f]);

    const rank = FindingsManager.SEVERITY_RANK;
    for (const group of byLine.values()) {
      const winner = group.reduce((acc, f) => (rank[f.severity] > rank[acc.severity] ? f : acc), group[0]!);
      const atWinnerLevel = group.filter((f) => f.severity === winner.severity).length;
      const display = atWinnerLevel >= 2 ? FindingsManager.SEVERITY_BUMP[winner.severity] : winner.severity;
      const endLine = Math.max(...group.map((f) => f.endLine));
      bySeverity[display].push({ range: toRange(editor.document, winner.startLine, endLine), hoverMessage: this.hoverForGroup(group) });
    }

    for (const severity of Object.keys(bySeverity) as FindingSeverity[]) {
      editor.setDecorations(this.decorationTypes[severity], bySeverity[severity]);
    }
  }

  private hoverForGroup(group: StoredFinding[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    group.forEach((f, i) => {
      const glyph = f.severity === 'error' ? '◆' : f.severity === 'warning' ? '▲' : '●';
      const origin = f.source === 'ia' ? 'IA' : f.source === 'colisao' ? 'colisão provada' : 'grafo';
      md.appendMarkdown(`**${glyph} linha ${f.startLine + 1} · #${f.id}** _(${origin})_\n\n`);
      md.appendText(f.message);
      if (f.impact) {
        md.appendMarkdown('\n\n---\n**Pode afetar outra área:** ');
        md.appendText(f.impact);
      }
      if (i < group.length - 1) md.appendMarkdown('\n\n---\n');
    });
    md.appendMarkdown('\n\n---\n_Pergunte no chat do ShielDepy citando o #id específico._');
    return md;
  }

  private toDiagnostic(f: StoredFinding): vscode.Diagnostic {
    const doc = vscode.workspace.textDocuments.find((d) => sameFile(d.uri, f.file));
    const diagnostic = new vscode.Diagnostic(toRange(doc, f.startLine, f.endLine), f.message, SEVERITY[f.severity]);
    diagnostic.source = SOURCE_LABEL[f.source];
    diagnostic.code = f.id;
    if (f.related?.length) {
      diagnostic.relatedInformation = f.related.map(
        (r) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(r.file), new vscode.Position(r.line, 0)), r.message)
      );
    }
    return diagnostic;
  }

  private decoration(rgb: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      backgroundColor: `rgba(${rgb}, 0.26)`,
      overviewRulerColor: `rgba(${rgb}, 0.9)`,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }
}

const SEVERITY: Record<FindingSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export function sameFile(uri: vscode.Uri, fileId: string): boolean {
  return uri.scheme === 'file' && toFileId(uri.fsPath) === fileId;
}

/** Linhas → Range; com o documento aberto, vai até o fim real da última linha. */
export function toRange(doc: vscode.TextDocument | undefined, startLine: number, endLine: number): vscode.Range {
  if (!doc) return new vscode.Range(startLine, 0, endLine, 1000);
  const last = Math.max(doc.lineCount - 1, 0);
  const start = doc.lineAt(Math.min(Math.max(startLine, 0), last));
  const end = doc.lineAt(Math.min(Math.max(endLine, startLine, 0), last));
  return new vscode.Range(start.range.start, end.range.end);
}
