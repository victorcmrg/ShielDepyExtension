import * as vscode from 'vscode';
import { isAbortError, scanForRisks } from '@shieldepy/agent';
import { isSymbolNode, toFileId, type Finding } from '@shieldepy/core';
import { config } from '../config';
import type { AiService } from '../services/AiService';
import { findWorkspaceFiles, isAnalyzable } from '../workspace/files';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import type { AnalyzingDecorationProvider } from './AnalyzingDecorationProvider';
import { computeChangedExcerpt, preserveOutside } from './excerpt';
import type { FindingsManager } from './FindingsManager';
import type { ScanAnimator } from './ScanAnimator';

/**
 * Decide QUANDO analisar (edição com idle, salvar, abrir) e COMO:
 *   1. reindexa o arquivo no modelo — o ÚNICO lugar que faz isso numa análise (item 2.4)
 *   2. achados determinísticos grátis: ciclos e referências HTML→CSS quebradas
 *   3. varredura via IA só do trecho ainda não verificado, recebendo os fatos já provados
 * Colisões ficam com o CollisionPublisher (dependem do workspace inteiro, não deste arquivo).
 */
export class BackgroundAnalyzer implements vscode.Disposable {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generation = new Map<string, number>();
  private readonly controllers = new Map<string, AbortController>();
  /** Última versão do documento já analisada ou em análise — evita rodar duas vezes a mesma (abrir + salvar). */
  private readonly analyzedVersion = new Map<string, number>();
  /** "Já verificado": texto da última varredura de IA bem-sucedida de cada arquivo. */
  private readonly lastScannedText = new Map<string, string>();

  constructor(
    private readonly model: WorkspaceModel,
    private readonly ai: AiService,
    private readonly findings: FindingsManager,
    private readonly analyzing: AnalyzingDecorationProvider,
    private readonly animator: ScanAnimator,
    private readonly log: (message: string) => void,
    /** Sistema ligado nas settings E a conta com acesso liberado — sem isso, nada roda. */
    private readonly isActive: () => boolean
  ) {}

  /** Debounced — em todo `onDidChangeTextDocument` (digitar, colar, edição programática). */
  schedule(doc: vscode.TextDocument): void {
    if (!this.isActive() || config.analysisTrigger() === 'onSave' || !isAnalyzable(doc)) return;
    const key = toFileId(doc.uri.fsPath);
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.analyze(doc);
      }, config.idleMs())
    );
  }

  /** Imediato — ao salvar/abrir. Pula se essa MESMA versão já foi analisada. */
  runNow(doc: vscode.TextDocument): void {
    if (!this.isActive() || !isAnalyzable(doc)) return;
    const key = toFileId(doc.uri.fsPath);
    if (this.analyzedVersion.get(key) === doc.version && !this.timers.has(key)) return;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    void this.analyze(doc);
  }

  /** Varredura sob demanda do workspace inteiro — mesmo pipeline, em lote. */
  async scanWorkspace(
    onProgress?: (fileName: string, index: number, total: number) => void,
    token?: vscode.CancellationToken
  ): Promise<{ filesScanned: number; totalFindings: number }> {
    let filesScanned = 0;
    let totalFindings = 0;
    if (!this.isActive()) return { filesScanned, totalFindings };
    const files = await findWorkspaceFiles(500);
    for (let i = 0; i < files.length; i++) {
      if (token?.isCancellationRequested) break;
      const uri = files[i]!;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (!isAnalyzable(doc)) continue;
        onProgress?.(uri.path.split('/').pop() ?? uri.fsPath, i + 1, files.length);
        await this.analyze(doc);
        filesScanned += 1;
        totalFindings += this.findings.get(toFileId(uri.fsPath)).length;
      } catch (err) {
        this.log(`[BackgroundAnalyzer] falha ao escanear ${uri.fsPath}: ${err}`);
      }
    }
    return { filesScanned, totalFindings };
  }

  /** Documento fechado: cancela o que estiver pendente. Os achados continuam (o arquivo ainda existe). */
  cancel(uri: vscode.Uri): void {
    const key = toFileId(uri.fsPath);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.controllers.get(key)?.abort();
  }

  /** Arquivo deletado: esquece tudo sobre ele. */
  forget(uri: vscode.Uri): void {
    this.cancel(uri);
    const key = toFileId(uri.fsPath);
    this.generation.delete(key);
    this.analyzedVersion.delete(key);
    this.lastScannedText.delete(key);
    this.findings.clear(key);
  }

  /** Acesso perdido: cancela tudo que está pendente/em voo e esquece o "já verificado". */
  cancelAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const c of this.controllers.values()) c.abort();
    this.timers.clear();
    this.analyzedVersion.clear();
    this.lastScannedText.clear();
  }

  dispose(): void {
    this.cancelAll();
  }

  private async analyze(doc: vscode.TextDocument): Promise<void> {
    // Chamado via `void this.analyze(...)` — uma rejeição aqui viraria promise órfã.
    this.analyzing.start(doc.uri);
    try {
      await this.analyzeUnsafe(doc);
    } catch (err) {
      if (!isAbortError(err)) this.log(`[BackgroundAnalyzer] falha inesperada analisando ${doc.uri.fsPath}: ${err}`);
    } finally {
      this.analyzing.stop(doc.uri);
    }
  }

  /** Onde ficam os outros símbolos de um ciclo (sem repetir e sem o próprio símbolo). */
  private cycleParticipants(self: string, path: string[]): Array<{ file: string; line: number; message: string }> {
    const seen = new Set<string>();
    const out: Array<{ file: string; line: number; message: string }> = [];
    for (const id of path) {
      if (id === self || seen.has(id)) continue;
      seen.add(id);
      const attrs = this.model.graph.nodeAttributes(id);
      if (!attrs || !isSymbolNode(attrs)) continue;
      out.push({ file: attrs.file, line: attrs.startLine, message: attrs.name });
    }
    return out.slice(0, 3); // balão legível: no máximo três trechos
  }

  private async analyzeUnsafe(doc: vscode.TextDocument): Promise<void> {
    const key = toFileId(doc.uri.fsPath);
    const myGeneration = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, myGeneration);
    this.analyzedVersion.set(key, doc.version);
    const stale = () => myGeneration !== this.generation.get(key);

    // Uma análise nova cancela a chamada de IA da anterior DE VERDADE (item 3.3) — antes a
    // resposta velha só era ignorada depois de chegar, e os tokens eram gastos do mesmo jeito.
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);

    const text = doc.getText();
    this.model.updateFile(doc.uri.fsPath, text);

    const findings: Finding[] = [];
    const provenFacts: string[] = [];

    for (const cycle of this.model.graph.cyclesInFile(key)) {
      const chain = cycle.labels.join(' → ');
      provenFacts.push(`${cycle.recursion ? 'recursão' : 'ciclo de chamadas'}: ${chain}`);
      findings.push({
        // As outras funções do ciclo: o hover e o balão mostram o código delas ("o que isto afeta").
        related: this.cycleParticipants(cycle.symbolId, cycle.path),
        file: key,
        startLine: cycle.startLine,
        endLine: cycle.endLine,
        // Recursão no mesmo arquivo é quase sempre de propósito (parser, resolvedor): leve (Q3 do plano).
        severity: cycle.recursion ? 'info' : 'warning',
        message: cycle.recursion ? `Recursão entre funções deste arquivo envolvendo "${cycle.name}".` : `Ciclo de chamadas detectado envolvendo "${cycle.name}".`,
        impact: cycle.recursion
          ? `Cadeia: ${chain} — em geral é de propósito; confira se toda volta tem uma condição de parada.`
          : `Cadeia do ciclo: ${chain} — uma mudança aqui pode re-disparar este mesmo símbolo (efeito cascata / loop infinito entre componentes).`,
        source: 'grafo',
        confidence: 100,
        key: `ciclo:${cycle.name}`,
      });
    }

    for (const ref of this.model.graph.findUnresolvedHtmlReferences(key)) {
      findings.push({
        file: key,
        startLine: ref.line,
        endLine: ref.line,
        severity: 'warning',
        message: `"${ref.token}" é usado neste HTML mas não existe em nenhum CSS vinculado (<link>).`,
        impact: 'Pode ser aplicado via JS (classList) de propósito, ou o vínculo com o CSS quebrou — confira o seletor correspondente.',
        source: 'grafo',
        confidence: 100,
        key: `html:${ref.token}`,
      });
    }

    for (const c of this.model.collisionsInvolving(key)) {
      provenFacts.push(`colisão ${c.type} no campo "${c.field}" (${c.resource}/${c.event})`);
    }

    const previousAi = this.findings.getGroup(key, 'analysis').filter((f) => f.source === 'ia');
    const provider = await this.ai.provider();
    if (!provider) {
      findings.push(...previousAi);
    } else if (this.lastScannedText.get(key) === text) {
      findings.push(...previousAi); // nada novo desde a última varredura — não gasta chamada
    } else {
      const previousText = this.lastScannedText.get(key);
      const excerpt = previousText !== undefined ? computeChangedExcerpt(previousText, text) : null;
      const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
      const parser = /\.[mc]?[tj]sx?$/i.test(doc.fileName) ? this.model.graph.tsParser : undefined;
      if (editor && parser) this.animator.run(editor, parser, excerpt?.startLine ?? 0, excerpt?.endLine ?? Math.max(doc.lineCount - 1, 0));

      try {
        const risks = await this.ai.run(() =>
          scanForRisks(
            provider,
            {
              text: excerpt ? excerpt.text : text,
              startLine: excerpt?.startLine ?? 0,
              subgraph: this.model.graph.getImpactSubgraph(key, 2),
              language: config.languageName(),
              provenFacts,
              signal: controller.signal,
            },
            this.log
          )
        );
        if (stale()) return;

        const preserved = excerpt ? preserveOutside(previousAi, excerpt) : [];
        const last = Math.max(doc.lineCount - 1, 0);
        findings.push(...preserved);
        for (const r of risks) {
          const startLine = Math.min(r.startLine, last);
          findings.push({
            file: key,
            startLine,
            endLine: Math.min(Math.max(r.endLine, startLine), last),
            severity: r.severity,
            message: r.message,
            impact: r.impact,
            source: 'ia',
            // #id estável mesmo se a IA reescrever a frase (item 4.2): âncora = texto da linha + severidade.
            key: `ia:${r.severity}:${doc.lineAt(startLine).text.trim()}`,
          });
        }
        this.lastScannedText.set(key, text);
        this.log(
          `[BackgroundAnalyzer] ${doc.uri.fsPath}: ${excerpt ? `incremental (linhas ${excerpt.startLine}-${excerpt.endLine})` : 'completa'}, ${risks.length} risco(s) novo(s), ${preserved.length} preservado(s).`
        );
      } catch (err) {
        if (isAbortError(err) || stale()) return;
        this.log(`[BackgroundAnalyzer] falha na varredura de ${doc.uri.fsPath}: ${err}`);
        findings.push(...previousAi); // mantém os últimos achados válidos em vez de apagar tudo
      } finally {
        if (editor) this.animator.stop(editor);
      }
    }

    // Acesso pode ter caído enquanto a IA respondia — não republica achados de conta suspensa.
    if (!stale() && this.isActive()) this.findings.set(key, 'analysis', findings);
  }
}
