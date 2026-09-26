import * as vscode from 'vscode';
import type { Finding, FindingSeverity, StoredFinding } from './types';
import { FindingsCache } from './FindingsCache';

/**
 * Dona única do estado de "problemas encontrados" por arquivo. Um `BackgroundAnalyzer.analyze()`
 * só produz `Finding[]` — é aqui que isso vira, ao mesmo tempo:
 *   1. Um ID estável e permanente (via `FindingsCache`), pra poder ser citado depois no chat
 *   2. `vscode.Diagnostic` (painel Problems + sublinhado)
 *   3. Marca-texto colorido por severidade (vermelho/amarelo/verde) com hover explicando a linha,
 *      o ID, e o impacto em outra área, se houver
 *   4. Um evento que a sidebar (`ShieldepyViewProvider`) escuta para atualizar a lista em tempo real
 */
export class FindingsManager {
  private readonly store = new Map<string, StoredFinding[]>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('shieldepy');
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly decorationTypes: Record<FindingSeverity, vscode.TextEditorDecorationType> = {
    error: vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(248, 81, 73, 0.28)',
      overviewRulerColor: 'rgba(248, 81, 73, 0.9)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: false,
    }),
    warning: vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(234, 179, 8, 0.28)',
      overviewRulerColor: 'rgba(234, 179, 8, 0.9)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: false,
    }),
    info: vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(63, 185, 80, 0.24)',
      overviewRulerColor: 'rgba(63, 185, 80, 0.9)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      isWholeLine: false,
    }),
  };

  private readonly visibleEditorsListener: vscode.Disposable;

  constructor(private readonly cache: FindingsCache) {
    this.visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) this.applyDecorations(editor);
    });
  }

  set(uri: vscode.Uri, findings: Finding[]): StoredFinding[] {
    const stored = this.cache.record(uri, findings);
    this.store.set(uri.toString(), stored);
    this.diagnostics.set(uri, stored.map((f) => this.toDiagnostic(f)));

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) this.applyDecorations(editor);
    }

    this.changeEmitter.fire(uri);
    return stored;
  }

  get(uri: vscode.Uri): StoredFinding[] {
    return this.store.get(uri.toString()) ?? [];
  }

  /**
   * Acha um achado pelo #id em QUALQUER arquivo já visto, mesmo que não seja o arquivo aberto
   * agora — é o que deixa o chat entender "sobre qual erro" mesmo citado em texto livre, sem
   * precisar do botão "Ask AI" nem do arquivo estar em foco.
   */
  getById(id: string): (StoredFinding & { file: string }) | undefined {
    return this.cache.get(id);
  }

  /** Todos os arquivos com achado ativo agora — base pras "gavetas" por arquivo na sidebar. */
  getAllByFile(): Array<{ uri: vscode.Uri; findings: StoredFinding[] }> {
    const result: Array<{ uri: vscode.Uri; findings: StoredFinding[] }> = [];
    for (const [uriString, findings] of this.store) {
      if (findings.length > 0) result.push({ uri: vscode.Uri.parse(uriString), findings });
    }
    return result;
  }

  clear(uri: vscode.Uri): void {
    this.store.delete(uri.toString());
    this.diagnostics.delete(uri);

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri.toString()) {
        for (const type of Object.values(this.decorationTypes)) editor.setDecorations(type, []);
      }
    }

    this.changeEmitter.fire(uri);
  }

  dispose(): void {
    this.diagnostics.dispose();
    this.visibleEditorsListener.dispose();
    this.changeEmitter.dispose();
    for (const type of Object.values(this.decorationTypes)) type.dispose();
  }

  private static readonly SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, error: 2 };
  private static readonly SEVERITY_BUMP: Record<FindingSeverity, FindingSeverity> = {
    info: 'warning',
    warning: 'error',
    error: 'error',
  };

  /**
   * Duas decorations de severidade diferente na MESMA linha borravam a cor (as duas pintavam
   * o fundo, o resultado visual era uma mistura ilegível). Agora resolve por linha: só a
   * severidade mais grave do grupo pinta; e se tiver 2+ achados NO MESMO nível (ex: dois
   * warnings importantes), sobe um degrau na exibição (2 warnings ficam vermelhos) — o
   * Problems panel e a lista da sidebar continuam mostrando cada achado individualmente,
   * só o fundo do editor é que fica sem sobreposição.
   */
  private applyDecorations(editor: vscode.TextEditor): void {
    const findings = this.get(editor.document.uri);
    const bySeverity: Record<FindingSeverity, vscode.DecorationOptions[]> = { error: [], warning: [], info: [] };

    const byLine = new Map<number, StoredFinding[]>();
    for (const finding of findings) {
      const line = finding.range.start.line;
      const group = byLine.get(line);
      if (group) group.push(finding);
      else byLine.set(line, [finding]);
    }

    for (const group of byLine.values()) {
      const rank = FindingsManager.SEVERITY_RANK;
      const winner = group.reduce((acc, f) => (rank[f.severity] > rank[acc.severity] ? f : acc), group[0]);
      const atWinnerLevel = group.filter((f) => f.severity === winner.severity).length;
      const displaySeverity = atWinnerLevel >= 2 ? FindingsManager.SEVERITY_BUMP[winner.severity] : winner.severity;
      const widestRange = group.reduce(
        (acc, f) => (f.range.end.character > acc.end.character ? f.range : acc),
        winner.range
      );

      bySeverity[displaySeverity].push({
        range: widestRange,
        hoverMessage: this.hoverForGroup(group),
      });
    }

    for (const severity of Object.keys(bySeverity) as FindingSeverity[]) {
      editor.setDecorations(this.decorationTypes[severity], bySeverity[severity]);
    }
  }

  private hoverForGroup(group: StoredFinding[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;

    for (let i = 0; i < group.length; i++) {
      const finding = group[i];
      const glyph = finding.severity === 'error' ? '◆' : finding.severity === 'warning' ? '▲' : '●';
      md.appendMarkdown(`**${glyph} linha ${finding.range.start.line + 1} · #${finding.id}**\n\n${finding.message}`);
      if (finding.impact) {
        md.appendMarkdown(`\n\n---\n**Pode afetar outra área:** ${finding.impact}`);
      }
      if (i < group.length - 1) md.appendMarkdown('\n\n---\n');
    }

    md.appendMarkdown('\n\n---\n_Pergunte no chat do ShielDepy citando o #id específico._');
    return md;
  }

  private toDiagnostic(finding: StoredFinding): vscode.Diagnostic {
    const diagnostic = new vscode.Diagnostic(finding.range, finding.message, this.severityToVsCode(finding.severity));
    diagnostic.source = finding.source === 'grafo' ? 'ShielDepy (grafo)' : 'ShielDepy';
    diagnostic.code = finding.id;
    return diagnostic;
  }

  private severityToVsCode(severity: FindingSeverity): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error':
        return vscode.DiagnosticSeverity.Error;
      case 'info':
        return vscode.DiagnosticSeverity.Information;
      default:
        return vscode.DiagnosticSeverity.Warning;
    }
  }
}
