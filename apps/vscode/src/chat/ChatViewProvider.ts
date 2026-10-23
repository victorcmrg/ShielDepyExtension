import { basename } from 'node:path';
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
import type { AuthService } from '../services/AuthService';
import { strings, t, type Key } from '../i18n';
import { escapeHtml, renderWebview } from '../views/webview';
import { workspaceRoots } from '../workspace/files';
import { resolveInsideWorkspace } from '../workspace/path-guard';
import { verifyProposedFix, type RiskScan } from '../workspace/verify-fix';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  /** O que a IA lê (completo: citações, impacto, tudo). */
  text: string;
  /** Correção proposta — fica AQUI, na extensão; o webview só recebe o caminho e devolve o id do turno. */
  fix?: { path: string; content: string };
  /** O que a pessoa vê, quando difere do texto da IA: frase curta + achados como cards que expandem. */
  view?: TurnView;
}

interface TurnView {
  display: string;
  cards?: FindingCard[];
  outro?: string;
}

/** Achado citado no chat, em forma de card (fechado: forma + #n + frase; aberto: arquivo, linha, por quê). */
interface FindingCard {
  ref: number;
  severity: string;
  message: string;
  fileName: string;
  line: number;
  impact: string;
  conflicts: string[];
}

export interface FindingAttachment {
  id: string;
  /** Número curto da sessão (#3) — é o que aparece pra pessoa e pra IA. */
  ref?: number;
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
    private readonly auth: AuthService,
    private readonly log: (message: string) => void
  ) {}

  /** O chat só trava quando a empresa desliga a IA; sem conta, vale a chave do usuário (modo local). */
  private postAccess(): void {
    this.post({
      type: 'access',
      block: this.auth.companyAiBlock(),
      company: this.auth.getCachedMe()?.companyName ?? null,
      remote: this.auth.folderAccess().find((f) => !f.allowed && f.remote)?.remote ?? null,
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    this.render(webviewView);
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      // Idioma novo: remonta o HTML; o "ready" dele recebe o histórico de novo.
      if (e.affectsConfiguration('shieldepy.language')) this.render(webviewView);
    });

    const authListener = this.auth.onDidChangeAuth(() => {
      if (this.auth.companyAiBlock()) this.inFlight?.abort();
      this.postAccess();
    });
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'ready':
          this.post({ type: 'history', turns: this.turns.map(toView) });
          this.postAccess();
          break;
        case 'refreshAccess':
          void vscode.commands.executeCommand(CMD.refreshAccess);
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
    webviewView.onDidDispose(() => {
      authListener.dispose();
      configListener.dispose();
      this.view = undefined;
    });
  }

  private render(webviewView: vscode.WebviewView): void {
    const h = (key: Key) => escapeHtml(t(key));
    webviewView.webview.html = renderWebview({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      asset: 'chat',
      initial: { t: strings() },
      body: `
  <div id="lock" class="lock" hidden>
    <span class="lock-mark" aria-hidden="true"></span>
    <h2 class="lock-title" id="lockTitle"></h2>
    <p class="lock-text" id="lockText"></p>
    <button id="lockAction" class="pill-btn"></button>
  </div>
  <div id="messages"><div class="empty-hint">${h('chatEmpty')}</div></div>
  <div id="thinking"><span class="morph-shape"></span><span id="thinkingText"></span><button id="stopBtn" class="text-btn">${h('stop')}</button></div>
  <div id="attachmentsRow" class="attachments-row"></div>
  <div id="inputRow">
    <textarea id="inputBox" rows="1" placeholder="${h('chatPlaceholder')}" aria-label="${h('message')}"></textarea>
    <button id="sendBtn" aria-label="${h('send')}" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg></button>
  </div>`,
    });
  }

  /** Card de um achado pelo #id estável (o que o chat mostra no lugar do texto longo). */
  private cardFor(id: string): FindingCard | undefined {
    const f = this.findings.getById(id);
    if (!f) return undefined;
    return {
      ref: this.findings.refOf(f.id),
      severity: f.severity,
      message: f.message,
      fileName: basename(vscode.workspace.asRelativePath(vscode.Uri.file(f.file))),
      line: f.startLine,
      impact: f.impact ?? '',
      conflicts: (f.related ?? []).map((r) => basename(r.file)),
    };
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
      this.append('assistant', t('scanStart'));
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('scanProgress'), cancellable: true },
        (progress, token) => this.analyzer.scanWorkspace((fileName, i, total) => progress.report({ message: `${fileName} (${i}/${total})` }), token)
      );
      this.append(
        'assistant',
        result.totalFindings > 0
          ? t('scanFound', { files: result.filesScanned, total: result.totalFindings })
          : t('scanClean', { files: result.filesScanned })
      );
    } catch (err) {
      this.append('assistant', t('scanFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private append(role: Turn['role'], text: string, fix?: Turn['fix'], view?: TurnView): Turn {
    const turn: Turn = { id: this.nextId++, role, text, fix, view };
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
    // O webview já trava a caixa, mas a extensão é quem decide — confirma no servidor.
    await this.auth.refresh();
    if (this.auth.companyAiBlock()) {
      this.postAccess();
      return;
    }

    // A IA lê a citação completa; a pessoa vê só a pergunta e os achados como cards.
    const cards = attachments.map((a) => this.cardFor(a.id)).filter((c) => c !== undefined);
    this.append('user', citedMessage(trimmed, attachments), undefined, cards.length ? { display: trimmed, cards } : undefined);
    if (FULL_SCAN_RE.test(trimmed)) return this.runFullScan();

    const target = await this.resolveTarget(trimmed, attachments);
    const provider = await this.ai.provider();
    if (!provider) {
      const reply = this.offlineReply(target);
      this.append('assistant', reply.text, undefined, reply.view);
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
      if (isAbortError(err)) this.append('assistant', t('interrupted'));
      else this.append('assistant', t('aiError', { name: provider.name, error: err instanceof Error ? err.message : String(err) }));
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
      findings: this.findings.get(fileId).map((f) => serializeForPrompt(f, this.findings.refOf(f.id))),
    };
  }

  /**
   * Sem IA: responde com o que é determinístico (achados do arquivo) e aponta como configurar.
   * O texto completo fica no histórico (se uma IA entrar depois, ela lê tudo); a tela mostra cards.
   */
  private offlineReply(doc: vscode.TextDocument | undefined): { text: string; view: TurnView } {
    const found = (doc ? this.findings.get(toFileId(doc.uri.fsPath)) : []).filter((x) => x.source !== 'ia');
    const empty = doc ? t('offlineNone') : t('offlineNoFile');
    const lines = [t('offlineIntro')];
    if (found.length === 0) lines.push(empty);
    for (const f of found) {
      lines.push('', `#${this.findings.refOf(f.id)}, ${t('lineLower', { n: f.startLine + 1 })}: ${f.message}`);
      if (f.impact) lines.push(f.impact);
    }
    lines.push('', t('offlineOutro'));
    const cards = found.map((f) => this.cardFor(f.id)).filter((c) => c !== undefined);
    return {
      text: lines.join('\n'),
      view: { display: found.length ? t('offlineIntro') : `${t('offlineIntro')}\n${empty}`, cards, outro: t('offlineOutro') },
    };
  }

  /**
   * Arquivo de contexto da mensagem: anexo explícito; senão um #id citado em texto livre (mesmo
   * sem o arquivo em foco); por último o editor ativo.
   */
  private async resolveTarget(text: string, attachments: FindingAttachment[]): Promise<vscode.TextDocument | undefined> {
    let uri: vscode.Uri | undefined;
    if (attachments[0]?.fileId) uri = vscode.Uri.file(attachments[0].fileId);
    for (const match of uri ? [] : text.matchAll(/#(\d{1,5})\b/g)) {
      const entry = this.findings.getByRef(Number(match[1]));
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

function toView(turn: Turn) {
  if (turn.view) return { id: turn.id, role: turn.role, text: turn.view.display, cards: turn.view.cards ?? [], outro: turn.view.outro ?? '', fixPath: turn.fix?.path };
  const fix = turn.role === 'assistant' ? parseFixedFile(turn.text) : undefined;
  return { id: turn.id, role: turn.role, text: fix ? fix.explanation || turn.text : turn.text, cards: [], outro: '', fixPath: turn.fix?.path };
}

function serializeForPrompt(f: StoredFinding, ref: number) {
  return { id: String(ref), line: f.startLine + 1, severity: f.severity, message: f.message, impact: f.impact, source: f.source };
}

/** Junta os anexos (achados citados) na frente do texto digitado. */
function citedMessage(text: string, attachments: FindingAttachment[]): string {
  if (attachments.length === 0) return text;
  const citations = attachments.map((a) => `[#${a.ref ?? a.id} em ${a.fileName ?? 'arquivo'}:${a.line + 1}] ${a.message}`).join('\n');
  return text ? `${citations}\n\n${text}` : `${citations}\n\n${t('defaultQuestion')}`;
}
