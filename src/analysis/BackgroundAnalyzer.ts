import * as vscode from 'vscode';
import * as path from 'path';
import { GraphManager } from '../graph/GraphManager';
import { AnthropicService } from '../services/AnthropicService';
import { FindingsManager } from './FindingsManager';
import { AnalyzingDecorationProvider } from './AnalyzingDecorationProvider';
import { ScanAnimator } from './ScanAnimator';
import type { Finding } from './types';

const DEFAULT_IDLE_MS = 1200;
const CONTEXT_LINES = 8; // linhas de contexto ao redor do trecho alterado, mandadas junto pro Haiku
const EXCERPT_MAX_RATIO = 0.7; // se o trecho "alterado" já cobre isso do arquivo, manda o arquivo inteiro em vez de recortar

/**
 * Decide QUANDO analisar (digitação, colar, edição programática, ou salvar) e COMO
 * (reparse + checagem estrutural de ciclo no grafo + varredura leve via Haiku).
 * A exibição (diagnostics, marca-texto, lista da sidebar) é toda responsabilidade
 * do `FindingsManager` — este arquivo só produz `Finding[]` e entrega pra ele.
 */
export class BackgroundAnalyzer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generation = new Map<string, number>();
  // "Já verificado de acordo com todo o resto": texto e achados de IA da última varredura
  // bem-sucedida de cada arquivo. Uma passada nova só manda pro Haiku o trecho que difere
  // disso — o grafo (ciclos, subgrafo de impacto) sempre é recalculado por inteiro, é barato;
  // o que é caro (a chamada de IA) só roda sobre o que ainda não foi verificado.
  private readonly lastScannedText = new Map<string, string>();
  private readonly lastAiFindings = new Map<string, Finding[]>();

  constructor(
    private readonly graphManager: GraphManager,
    private readonly anthropicService: AnthropicService,
    private readonly findingsManager: FindingsManager,
    private readonly analyzingDecorations: AnalyzingDecorationProvider,
    private readonly scanAnimator: ScanAnimator,
    private readonly output: vscode.OutputChannel
  ) {}

  /** Agenda uma análise debounced — chame em todo `onDidChangeTextDocument` (digitar, colar, edição programática). */
  schedule(document: vscode.TextDocument): void {
    if (!this.isEnabled()) return;

    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const idleMs = vscode.workspace.getConfiguration('shieldepy').get<number>('backgroundAnalysis.idleMs', DEFAULT_IDLE_MS);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.analyze(document);
    }, idleMs);
    this.timers.set(key, timer);
  }

  /** Roda imediatamente, sem esperar o idle — chame em `onDidSaveTextDocument`. */
  runNow(document: vscode.TextDocument): void {
    if (!this.isEnabled()) return;

    const key = document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
    void this.analyze(document);
  }

  /**
   * Varredura sob demanda de todo o workspace — chamada pelo chat ("faça uma limpa na pasta")
   * ou pelo comando "ShielDepy: Analisar Pasta Inteira". Reaproveita o MESMO pipeline do
   * `analyze()` de cada arquivo (grafo + IA), só que disparado em lote e sem debounce.
   */
  async scanWorkspace(
    onProgress?: (fileName: string, index: number, total: number) => void,
    token?: vscode.CancellationToken
  ): Promise<{ filesScanned: number; totalFindings: number }> {
    let filesScanned = 0;
    let totalFindings = 0;

    let files: vscode.Uri[];
    try {
      files = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx,html,htm,css}', '**/{node_modules,dist,out,.git}/**', 500);
    } catch (err) {
      this.output.appendLine(`[BackgroundAnalyzer] falha ao listar arquivos do workspace: ${err}`);
      return { filesScanned, totalFindings };
    }

    for (let i = 0; i < files.length; i++) {
      if (token?.isCancellationRequested) break;
      const uri = files[i];

      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        onProgress?.(doc.uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath, i + 1, files.length);
        await this.analyze(doc);
        filesScanned += 1;
        totalFindings += this.findingsManager.get(uri).length;
      } catch (err) {
        this.output.appendLine(`[BackgroundAnalyzer] falha ao escanear ${uri.fsPath}: ${err}`);
      }
    }

    return { filesScanned, totalFindings };
  }

  clear(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    this.generation.delete(key);
    this.lastScannedText.delete(key);
    this.lastAiFindings.delete(key);
    this.findingsManager.clear(uri);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('shieldepy').get<boolean>('backgroundAnalysis.enabled', true);
  }

  private async analyze(document: vscode.TextDocument): Promise<void> {
    // Chamado só via `void this.analyze(document)` (schedule/runNow), sem `.catch()` em
    // nenhum call site — uma rejeição não tratada aqui vira uma promise órfã capaz de
    // derrubar o processo. O try/catch cobre o método inteiro por segurança.
    this.analyzingDecorations.start(document.uri);
    try {
      await this.analyzeUnsafe(document);
    } catch (err) {
      this.output.appendLine(`[BackgroundAnalyzer] falha inesperada analisando ${document.uri.fsPath}: ${err}`);
    } finally {
      this.analyzingDecorations.stop(document.uri);
    }
  }

  private async analyzeUnsafe(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const myGeneration = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, myGeneration);

    // Reparseia antes de ler o grafo — garante que a vizinhança reflita o texto atual,
    // independente do debounce (mais lento) que mantém o grafo geral do workspace.
    await this.graphManager.updateFile(document.uri, document.getText());
    if (myGeneration !== this.generation.get(key)) return; // documento mudou de novo nesse meio-tempo

    const subgraph = this.graphManager.getImpactSubgraph(key, 2);
    const findings: Finding[] = [];

    const ownSymbols = subgraph.nodes.filter((n) => n.attributes.file === key);
    for (const sym of ownSymbols) {
      const cycle = this.graphManager.findCycleThrough(sym.id);
      if (cycle) {
        const start = Number(sym.attributes.startLine ?? 0);
        const end = Number(sym.attributes.endLine ?? start);
        const chain = cycle.map((id) => this.graphManager.getLabel(id)).join(' → ');
        findings.push({
          range: new vscode.Range(start, 0, end, 0),
          severity: 'warning',
          message: `Ciclo de chamadas detectado envolvendo "${sym.attributes.name}".`,
          impact: `Cadeia do ciclo: ${chain} — uma mudança aqui pode re-disparar este mesmo símbolo (efeito cascata / loop infinito entre componentes).`,
          source: 'grafo',
        });
      }
    }

    // Análise por grupo de arquivos: um HTML que puxa um CSS (via <link>) e usa uma classe/id
    // que não existe em nenhum CSS vinculado — pega exatamente o caso "o HTML quebra por causa
    // de algo que mudou no CSS conectado", de graça, sem gastar chamada de IA.
    const ext = path.extname(document.uri.fsPath).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      const unresolved = this.graphManager.findUnresolvedHtmlReferences(key);
      const lastLine = Math.max(document.lineCount - 1, 0);
      for (const ref of unresolved) {
        const line = document.lineAt(Math.min(ref.line, lastLine));
        findings.push({
          range: line.range,
          severity: 'warning',
          message: `"${ref.token}" é usado neste HTML mas não existe em nenhum CSS vinculado (<link>).`,
          impact: 'Pode ser aplicado via JS (classList) de propósito, ou o vínculo com o CSS quebrou — confira o seletor correspondente.',
          source: 'grafo',
        });
      }
    }

    const currentText = document.getText();
    const previousText = this.lastScannedText.get(key);

    if (previousText === currentText) {
      // Conteúdo idêntico ao da última varredura bem-sucedida — nada "novo ou ainda não
      // verificado" aqui. Reaproveita os achados de IA já conhecidos em vez de gastar uma
      // chamada à toa (o achado estrutural do grafo, acima, já foi recalculado do zero mesmo assim).
      findings.push(...(this.lastAiFindings.get(key) ?? []));
    } else {
      const excerpt = previousText ? this.computeChangedExcerpt(previousText, currentText) : null;
      const animEditor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);

      if (!animEditor) {
        this.output.appendLine(`[BackgroundAnalyzer] overlay de leitura não iniciado: ${document.uri.fsPath} não está visível em nenhum editor aberto agora.`);
      } else {
        const isJsx = document.uri.fsPath.endsWith('.tsx') || document.uri.fsPath.endsWith('.jsx');
        const tree = this.graphManager.parseSnippet(currentText, isJsx);
        if (!tree) {
          this.output.appendLine(`[BackgroundAnalyzer] overlay de leitura não iniciado: parseSnippet falhou pra ${document.uri.fsPath} (grafo pronto? ${this.graphManager.isReady}).`);
        } else {
          const animStart = excerpt ? excerpt.startLine : 0;
          const animEnd = excerpt ? excerpt.endLine : Math.max(document.lineCount - 1, 0);
          this.output.appendLine(`[BackgroundAnalyzer] overlay de leitura iniciado: linhas ${animStart}-${animEnd}.`);
          this.scanAnimator.run(animEditor, tree, animStart, animEnd);
        }
      }

      try {
        let risks: Awaited<ReturnType<AnthropicService['scanForRisks']>>;
        let preserved: Finding[] = [];

        if (excerpt) {
          risks = await this.anthropicService.scanForRisks(excerpt.text, subgraph, excerpt.startLine);
          // Achados antigos fora do trecho recortado continuam válidos — as linhas deles não mudaram.
          preserved = (this.lastAiFindings.get(key) ?? []).filter(
            (f) => f.range.end.line < excerpt.startLine || f.range.start.line > excerpt.endLine
          );
          this.output.appendLine(
            `[BackgroundAnalyzer] ${document.uri.fsPath}: varredura incremental (linhas ${excerpt.startLine}-${excerpt.endLine} de ${document.lineCount}), ${risks.length} risco(s) novo(s), ${preserved.length} preservado(s) sem re-verificar.`
          );
        } else {
          risks = await this.anthropicService.scanForRisks(currentText, subgraph);
          this.output.appendLine(
            `[BackgroundAnalyzer] ${document.uri.fsPath}: varredura completa (arquivo novo ou mudança grande demais pra recortar), ${risks.length} risco(s).`
          );
        }

        if (myGeneration !== this.generation.get(key)) return; // resposta obsoleta, documento já mudou de novo

        const lastLine = Math.max(document.lineCount - 1, 0);
        const aiFindings: Finding[] = [...preserved];
        for (const risk of risks) {
          const startLine = document.lineAt(Math.min(Math.max(risk.startLine, 0), lastLine));
          const endLine = document.lineAt(Math.min(Math.max(risk.endLine, 0), lastLine));
          aiFindings.push({
            range: new vscode.Range(startLine.range.start, endLine.range.end),
            severity: risk.severity,
            message: risk.message,
            impact: risk.impact || undefined,
            source: 'ia',
          });
        }

        this.lastScannedText.set(key, currentText);
        this.lastAiFindings.set(key, aiFindings);
        findings.push(...aiFindings);
      } catch (err) {
        this.output.appendLine(`[BackgroundAnalyzer] falha na varredura de ${document.uri.fsPath}: ${err}`);
        findings.push(...(this.lastAiFindings.get(key) ?? [])); // mantém os últimos achados válidos em vez de apagar tudo
      } finally {
        if (animEditor) this.scanAnimator.stop(animEditor);
      }
    }

    if (myGeneration === this.generation.get(key)) {
      this.output.appendLine(
        `[BackgroundAnalyzer] ${document.uri.fsPath}: publicando ${findings.length} achado(s) no total (grafo + IA).`
      );
      this.findingsManager.set(document.uri, findings);
    }
  }

  /**
   * Diff leve, sem dependência externa: acha o maior prefixo e sufixo de linhas iguais entre
   * a última versão verificada e a atual — o meio é "o que mudou". Só funciona bem (posições
   * preservadas) quando a contagem de linhas não mudou; se mudou, quem chama trata como "sem
   * corte possível" e manda o arquivo inteiro, pra não arriscar reportar linha errada.
   */
  private computeChangedExcerpt(
    oldText: string,
    newText: string
  ): { text: string; startLine: number; endLine: number } | null {
    if (oldText === newText) return null;

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    if (oldLines.length !== newLines.length) return null;

    const total = newLines.length;
    let prefix = 0;
    while (prefix < total && oldLines[prefix] === newLines[prefix]) prefix++;

    let suffix = 0;
    while (suffix < total - prefix && oldLines[total - 1 - suffix] === newLines[total - 1 - suffix]) suffix++;

    const changedStart = Math.max(prefix - CONTEXT_LINES, 0);
    const changedEnd = Math.min(total - 1 - suffix + CONTEXT_LINES, total - 1);

    if (changedEnd - changedStart + 1 >= total * EXCERPT_MAX_RATIO) return null;

    return {
      text: newLines.slice(changedStart, changedEnd + 1).join('\n'),
      startLine: changedStart,
      endLine: changedEnd,
    };
  }
}
