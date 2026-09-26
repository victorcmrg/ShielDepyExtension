import * as vscode from 'vscode';
import {
  codeChat,
  isAbortError,
  parseFixedFile,
  scanForRisks,
  stripFixedFile,
  type ChatMessage,
  type LLMProvider,
} from '@shieldepy/agent';
import { toFileId } from '@shieldepy/core';
import { config } from '../config';
import { CMD } from '../constants';
import type { BackgroundAnalyzer } from '../analysis/BackgroundAnalyzer';
import type { FindingsManager } from '../analysis/FindingsManager';
import type { StoredFinding } from '../analysis/FindingsCache';
import type { AiService } from '../services/AiService';
import { renderWebview } from '../views/webview';
import { workspaceRoots } from '../workspace/files';
import { resolveInsideWorkspace } from '../workspace/path-guard';
import { verifyProposedFix, type RiskScan } from '../workspace/verify-fix';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Correção proposta — fica AQUI, na extensão; o webview só recebe o caminho e devolve o id do turno. */
  fix?: { path: string; content: string };
}

export interface FindingAttachment {
  id: string;
  fileId: string;
  fileName?: string;
  line: number;
  message: string;
}

const MAX_TURNS_KEPT = 200;
const FULL_SCAN_RE = /\b(limpa|limpar|escane|escanear|varra|varrer|analis[ae]r?)\b.*\bpasta\b|\bscan\b.*\bfolder\b/i;

/**
 * Chat da sidebar — Q&A sobre achados, pedidos de correção (a IA reescreve o arquivo, a extensão
 * VERIFICA a proposta numa cópia do grafo e o usuário aplica com um clique), e o gatilho de
 * varredura da pasta inteira. Histórico em memória; só os ACHADOS vão pro cache permanente.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private turns: Turn[] = [];
  private nextId = 1;
  private inFlight: AbortController | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ai: AiService,
    private readonly model: WorkspaceModel,
    private readonly findings: FindingsManager,
    private readonly analyzer: BackgroundAnalyzer,
    private readonly log: (message: string) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webviewView.webview.html = renderWebview({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      asset: 'chat',
      body: `
  <div id="messages"><div class="empty-hint">Pergunte sobre um erro, peça uma correção, ou peça pra analisar a pasta inteira.</div></div>
  <div id="thinking"><span class="morph-shape"></span><span id="thinkingText"></span><button id="stopBtn" title="Parar">parar</button></div>
  <div id="attachmentsRow" class="attachments-row"></div>
  <div id="inputRow">
    <textarea id="inputBox" rows="2" placeholder="Pergunte sobre um erro, peça uma correção…"></textarea>
    <button id="sendBtn">Enviar</button>
  </div>`,
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'ready':
          this.post({ type: 'history', turns: this.turns.map(toView) });
          break;
        case 'send':
          await this.handleSend(String(message.text ?? ''), Array.isArray(message.attachments) ? message.attachments : []);
          break;
        case 'applyFix':
          await this.applyFix(Number(message.turnId));
          break;
        case 'stop':
          this.inFlight?.abort();
          break;
        case 'configureKey':
          void vscode.commands.executeCommand(CMD.setApiKey);
          break;
      }
    });
    webviewView.onDidDispose(() => (this.view = undefined));
  }

  /** "Ask AI" na sidebar: não pergunta nada sozinho, só ANEXA o achado na caixa de entrada. */
  attachFinding(finding: FindingAttachment): void {
    vscode.commands.executeCommand(CMD.focusChat).then(
      () => this.post({ type: 'attach', finding }),
      (err) => this.log(`[chat] falha ao focar o chat pra anexar achado: ${err}`)
    );
  }

  async runFullScan(): Promise<void> {
    try {
      await vscode.commands.executeCommand(CMD.focusChat);
      this.append('assistant', '🧹 Analisando todos os arquivos do workspace, um instante…');
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'ShielDepy: analisando a pasta inteira', cancellable: true },
        (progress, token) => this.analyzer.scanWorkspace((fileName, i, total) => progress.report({ message: `${fileName} (${i}/${total})` }), token)
      );
      const collisions = this.model.collisions().length;
      this.append(
        'assistant',
        result.totalFindings > 0
          ? `Analisei ${result.filesScanned} arquivo(s) e encontrei ${result.totalFindings} problema(s) no total${collisions ? `, incluindo ${collisions} colisão(ões) entre regras` : ''}. Eles já aparecem no painel "Problemas encontrados" e no Problems.`
          : `Analisei ${result.filesScanned} arquivo(s) e não encontrei nenhum problema. 🎉`
      );
    } catch (err) {
      this.append('assistant', `Falha ao analisar a pasta: ${err instanceof Error ? err.message : err}`);
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private append(role: Turn['role'], text: string, fix?: Turn['fix']): Turn {
    const turn: Turn = { id: this.nextId++, role, text, fix };
    this.turns.push(turn);
    if (this.turns.length > MAX_TURNS_KEPT) this.turns = this.turns.slice(-MAX_TURNS_KEPT);
    this.post({ type: 'append', turn: toView(turn) });
    return turn;
  }

  /** Histórico pra IA: correções antigas sem o arquivo inteiro (o estado atual vai fresco em activeFile). */
  private apiHistory(): ChatMessage[] {
    return this.turns.map((t) => ({ role: t.role, content: t.role === 'assistant' ? stripFixedFile(t.text) : t.text }));
  }

  private async handleSend(text: string, attachments: FindingAttachment[]): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    this.append('user', citedMessage(trimmed, attachments));
    if (FULL_SCAN_RE.test(trimmed)) return this.runFullScan();

    const target = await this.resolveTarget(trimmed, attachments);
    const provider = await this.ai.provider();
    if (!provider) {
      this.append('assistant', this.offlineReply(target));
      this.post({ type: 'needsKey' });
      return;
    }

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    this.post({ type: 'thinking', value: true });
    try {
      const reply = await this.ai.run(() => codeChat(provider, { ...this.context(target), history: this.apiHistory(), signal: controller.signal }));
      const final = target ? await this.verifyAndImprove(provider, reply, target, controller.signal) : reply;
      const fix = parseFixedFile(final);
      this.append('assistant', final, fix ? { path: fix.path, content: fix.content } : undefined);
    } catch (err) {
      if (isAbortError(err)) this.append('assistant', '(resposta interrompida)');
      else this.append('assistant', `Erro ao falar com a IA (${provider.name}): ${err instanceof Error ? err.message : err}`);
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined;
      this.post({ type: 'thinking', value: false });
    }
  }

  private context(doc: vscode.TextDocument | undefined, overrideText?: string) {
    if (!doc) return { language: config.languageName() };
    const fileId = toFileId(doc.uri.fsPath);
    return {
      language: config.languageName(),
      activeFile: { path: vscode.workspace.asRelativePath(doc.uri), text: overrideText ?? doc.getText() },
      subgraph: this.model.graph.getImpactSubgraph(fileId, 2),
      findings: this.findings.get(fileId).map(serializeForPrompt),
    };
  }

  /** Sem IA: responde com o que é determinístico (achados do arquivo) e aponta como configurar. */
  private offlineReply(doc: vscode.TextDocument | undefined): string {
    const found = doc ? this.findings.get(toFileId(doc.uri.fsPath)) : [];
    const lines = ['Nenhuma IA configurada — respondo só com o que foi PROVADO sem IA.'];
    if (found.length === 0) lines.push(doc ? 'Neste arquivo não há ciclos nem colisões.' : 'Abra um arquivo ou anexe um achado pra eu olhar.');
    for (const f of found.filter((x) => x.source !== 'ia')) {
      lines.push('', `#${f.id} · linha ${f.startLine + 1}: ${f.message}`);
      if (f.impact) lines.push(f.impact);
    }
    lines.push('', 'Pra conversar e pedir correções, configure uma chave (Anthropic ou Gemini).');
    return lines.join('\n');
  }

  /**
   * Arquivo de contexto da mensagem: anexo explícito; senão um #id citado em texto livre (mesmo
   * sem o arquivo em foco); por último o editor ativo.
   */
  private async resolveTarget(text: string, attachments: FindingAttachment[]): Promise<vscode.TextDocument | undefined> {
    let uri: vscode.Uri | undefined;
    if (attachments[0]?.fileId) uri = vscode.Uri.file(attachments[0].fileId);
    for (const match of uri ? [] : text.matchAll(/#([0-9a-f]{6,12})/gi)) {
      const entry = this.findings.getById(match[1]!);
      if (entry) {
        uri = vscode.Uri.file(entry.file);
        break;
      }
    }
    uri ??= vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') return undefined;
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      this.log(`[chat] não consegui abrir ${uri.fsPath}: ${err}`);
      return undefined;
    }
  }

  /**
   * Depois de propor uma correção: verifica de verdade (grafo + colisões grátis, uma varredura
   * paga) numa CÓPIA do modelo. Se sobrar problema, pede UMA nova tentativa mostrando o que ficou;
   * a segunda só recebe a checagem grátis, pra o custo de "corrigir" não crescer sem limite.
   */
  private async verifyAndImprove(provider: LLMProvider, reply: string, doc: vscode.TextDocument, signal: AbortSignal): Promise<string> {
    const fix = parseFixedFile(reply);
    if (!fix || fix.path !== vscode.workspace.asRelativePath(doc.uri)) return reply;

    const scan: RiskScan = (text, subgraph, provenFacts) =>
      this.ai.run(() => scanForRisks(provider, { text, subgraph, provenFacts, language: config.languageName(), signal }, this.log));

    try {
      const issues = await verifyProposedFix(this.model, doc.uri.fsPath, fix.content, scan);
      if (issues.length === 0) return reply;

      const retry = await this.ai.run(() =>
        codeChat(provider, {
          ...this.context(doc, fix.content),
          findings: [],
          history: [
            ...this.apiHistory(),
            { role: 'assistant', content: stripFixedFile(reply) },
            {
              role: 'user',
              content: `Sua correção anterior ainda deixa isto:\n${issues.map((i) => `- ${i}`).join('\n')}\nCorrija de novo, resolvendo isso também, sem desfazer o que já estava certo.`,
            },
          ],
          signal,
        })
      );
      const retryFix = parseFixedFile(retry);
      if (!retryFix) return retry;

      const remaining = await verifyProposedFix(this.model, doc.uri.fsPath, retryFix.content);
      return remaining.length === 0
        ? retry
        : `${retry}\n\nAtenção: mesmo depois de revisar, ainda parece ficar: ${remaining.join('; ')}. Considere pedir pra tentar de outro jeito.`;
    } catch (err) {
      if (isAbortError(err)) throw err;
      this.log(`[chat] falha ao verificar/melhorar a correção: ${err}`);
      return reply;
    }
  }

  /** Aplica a correção de um turno — só dentro do workspace (item 3.4) e só em arquivo que existe. */
  private async applyFix(turnId: number): Promise<void> {
    const fix = this.turns.find((t) => t.id === turnId)?.fix;
    const target = fix ? resolveInsideWorkspace(fix.path, workspaceRoots()) : undefined;
    if (!fix || !target) {
      void vscode.window.showErrorMessage(`ShielDepy: correção recusada — "${fix?.path ?? '?'}" está fora do workspace.`);
      this.post({ type: 'fixApplied', turnId, ok: false });
      return;
    }
    try {
      const uri = vscode.Uri.file(target);
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), fix.content);
      const ok = await vscode.workspace.applyEdit(edit);
      await vscode.window.showTextDocument(uri, { preview: false });
      this.post({ type: 'fixApplied', turnId, ok });
    } catch (err) {
      this.log(`[chat] falha ao aplicar correção em ${target}: ${err}`);
      this.post({ type: 'fixApplied', turnId, ok: false });
    }
  }
}

function toView(t: Turn) {
  const fix = t.role === 'assistant' ? parseFixedFile(t.text) : undefined;
  return { id: t.id, role: t.role, text: fix ? fix.explanation || t.text : t.text, fixPath: t.fix?.path };
}

function serializeForPrompt(f: StoredFinding) {
  return { id: f.id, line: f.startLine + 1, severity: f.severity, message: f.message, impact: f.impact, source: f.source };
}

/** Junta os anexos (achados citados) na frente do texto digitado. */
function citedMessage(text: string, attachments: FindingAttachment[]): string {
  if (attachments.length === 0) return text;
  const citations = attachments.map((a) => `[#${a.id} · ${a.fileName ?? 'arquivo'}:${a.line + 1}] ${a.message}`).join('\n');
  return text ? `${citations}\n\n${text}` : `${citations}\n\nComo eu resolvo isso?`;
}
