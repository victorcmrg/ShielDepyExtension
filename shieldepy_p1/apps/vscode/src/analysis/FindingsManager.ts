import * as vscode from 'vscode';
import { toFileId, type Finding, type FindingSeverity } from '@shieldepy/core';
import { config } from '../config';
import { CMD } from '../constants';
import { t } from '../i18n';
import { readSnippet, snippetMarkdown } from './conflictSnippet';
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
 *   1. um #id estável (via FindingsCache) e um número curto da sessão (#1, #2…) citável no chat
 *   2. `vscode.Diagnostic` (painel Problems + sublinhado), com a outra ponta da colisão em relatedInformation
 *   3. marca-texto por severidade com hover
 *   4. um evento que a sidebar escuta
 */
export class FindingsManager implements vscode.Disposable {
  private readonly groups = new Map<string, Map<FindingGroup, Finding[]>>();
  private readonly store = new Map<string, StoredFinding[]>();
  /**
   * Número curto de cada achado, fácil de falar no chat ("o #3"). Só em memória: recomeça do 1
   * quando o VS Code reinicia. O #id estável do cache continua sendo a identidade de verdade.
   */
  private readonly refs = new Map<string, number>();
  private readonly byRef = new Map<number, string>();
  private nextRef = 1;
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('shieldepy');
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changeEmitter.event;

  // Mesmas formas do painel na calha: quadrado = importante, triângulo = atenção, círculo = leve.
  private readonly decorationTypes: Record<FindingSeverity, vscode.TextEditorDecorationType>;
  private readonly visibleEditorsListener: vscode.Disposable;

  constructor(
    private readonly cache: FindingsCache,
    private readonly extensionUri: vscode.Uri
  ) {
    // No construtor (não como inicializador de campo): precisa do extensionUri já atribuído.
    this.decorationTypes = {
      error: this.decoration('255, 95, 87', 'error'),
      warning: this.decoration('254, 188, 46', 'warning'),
      info: this.decoration('74, 222, 150', 'info'),
    };
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
  /** Número curto do achado nesta sessão (atribuído na primeira vez que ele é publicado). */
  refOf(id: string): number {
    let ref = this.refs.get(id);
    if (ref === undefined) {
      ref = this.nextRef++;
      this.refs.set(id, ref);
      this.byRef.set(ref, id);
    }
    return ref;
  }

  /** "#3" citado no chat → o achado (mesmo de um arquivo que não está aberto). */
  getByRef(ref: number): StoredFinding | undefined {
    const id = this.byRef.get(ref);
    return id ? this.cache.get(id) : undefined;
  }

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

  /** Achados visíveis nesta linha que encostam em outro código (colisões com a outra ponta conhecida). */
  conflictsAt(fileId: string, line: number): StoredFinding[] {
    return this.get(fileId).filter((f) => f.related?.length && line >= f.startLine && line <= f.endLine);
  }

  /** Totais por severidade do que está VISÍVEL agora (status bar, contadores do painel). */
  counts(): Record<FindingSeverity, number> {
    const counts: Record<FindingSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const list of this.store.values()) for (const f of list) counts[f.severity] += 1;
    return counts;
  }

  /** Republica tudo — ex.: mudou `shieldepy.display.minSeverity`, o filtro vale pro que já foi achado. */
  refreshAll(): void {
    for (const fileId of [...this.groups.keys()]) this.publish(fileId);
  }

  /** Acesso perdido/logout: some com tudo (Problems, marca-texto, painel) de uma vez. */
  clearAll(): void {
    const files = [...this.groups.keys()];
    this.groups.clear();
    for (const fileId of files) this.publish(fileId);
  }

  dispose(): void {
    this.diagnostics.dispose();
    this.visibleEditorsListener.dispose();
    this.changeEmitter.dispose();
    for (const type of Object.values(this.decorationTypes)) type.dispose();
  }

  private publish(fileId: string): void {
    const minRank = FindingsManager.SEVERITY_RANK[config.minSeverity()] ?? 0;
    const all = [...(this.groups.get(fileId)?.values() ?? [])].flat();
    // O filtro só esconde: os grupos guardam tudo, então baixar o mínimo depois traz os achados de volta.
    const merged = all.filter((f) => FindingsManager.SEVERITY_RANK[f.severity] >= minRank);
    if (all.length === 0) this.groups.delete(fileId);
    const uri = vscode.Uri.file(fileId);
    if (merged.length === 0) {
      this.store.delete(fileId);
      this.diagnostics.delete(uri);
    } else {
      const stored = this.cache.record(fileId, merged);
      for (const f of stored) this.refOf(f.id);
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

  /**
   * O "balão" do editor: aparece no hover e, numa linha de colisão, ao clicar (ConflictBalloon).
   * Para colisões, expõe o código da outra ponta — quem está encostando neste trecho.
   */
  private hoverForGroup(group: StoredFinding[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    // Só os comandos do próprio balão podem rodar a partir de links — nada vindo do texto do achado.
    md.isTrusted = { enabledCommands: [CMD.openLocation, CMD.attachFinding] };
    // Só <span style="color"> — é o pouco de HTML que o hover do VS Code aceita; dá a cor da forma.
    md.supportHtml = true;
    group.forEach((f, i) => {
      const ref = this.refOf(f.id);
      // Cabeçalho: forma colorida, severidade, #número e linha.
      md.appendMarkdown(
        `<span style="color:${GLYPH_COLOR[f.severity]};">${GLYPH[f.severity]}</span>&nbsp; **${t(SEVERITY_KEY[f.severity])}** &nbsp;#${ref} &nbsp;${t('lineLower', { n: f.startLine + 1 })}\n\n`
      );
      md.appendText(f.message);
      if (f.impact) {
        md.appendMarkdown(`\n\n**${t('hoverImpact')}**\n\n`);
        md.appendText(f.impact);
      }
      // O que este achado afeta em outro lugar (outra ponta da colisão, outras funções do ciclo): com o código.
      for (const related of f.related ?? []) {
        const snippet = readSnippet(related);
        if (!snippet) continue;
        const where = snippet.folder ? `${snippet.folder}/${snippet.fileName}` : snippet.fileName;
        const open = commandLink(CMD.openLocation, [snippet.file, snippet.line]);
        md.appendMarkdown(`\n\n**${t('hoverAffects')}** [${escapeMd(where)}](${open}) &nbsp;${t('lineLower', { n: snippet.line + 1 })}\n\n`);
        md.appendMarkdown(snippetMarkdown(snippet));
      }
      const ask = commandLink(CMD.attachFinding, [{ id: f.id, ref, fileId: f.file, line: f.startLine, message: f.message }]);
      md.appendMarkdown(`\n\n---\n\n[$(sparkle) ${t('askAI')}](${ask})`);
      if (i < group.length - 1) md.appendMarkdown('\n\n---\n\n');
    });
    return md;
  }

  private toDiagnostic(f: StoredFinding): vscode.Diagnostic {
    const doc = vscode.workspace.textDocuments.find((d) => sameFile(d.uri, f.file));
    const diagnostic = new vscode.Diagnostic(toRange(doc, f.startLine, f.endLine), f.message, SEVERITY[f.severity]);
    diagnostic.source = SOURCE_LABEL[f.source];
    diagnostic.code = `#${this.refOf(f.id)}`;
    if (f.related?.length) {
      diagnostic.relatedInformation = f.related.map(
        (r) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(r.file), new vscode.Position(r.line, 0)), r.message)
      );
    }
    return diagnostic;
  }

  private decoration(rgb: string, severity: FindingSeverity): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      backgroundColor: `rgba(${rgb}, 0.16)`,
      overviewRulerColor: `rgba(${rgb}, 0.9)`,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      gutterIconPath: vscode.Uri.joinPath(this.extensionUri, 'media', 'gutter', `${severity}.svg`),
      gutterIconSize: 'contain',
    });
  }
}

const SEVERITY_KEY: Record<FindingSeverity, 'sevError' | 'sevWarning' | 'sevInfo'> = { error: 'sevError', warning: 'sevWarning', info: 'sevInfo' };
const GLYPH: Record<FindingSeverity, string> = { error: '■', warning: '▲', info: '●' };
const GLYPH_COLOR: Record<FindingSeverity, string> = { error: '#ff5f57', warning: '#febc2e', info: '#4ade96' };

function commandLink(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
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
