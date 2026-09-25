import * as vscode from 'vscode';
import * as path from 'path';
import { AnthropicService } from '../services/AnthropicService';
import { GraphManager } from '../graph/GraphManager';
import { FindingsManager } from '../analysis/FindingsManager';
import { BackgroundAnalyzer } from '../analysis/BackgroundAnalyzer';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface FindingAttachment {
  id: string;
  uri: string;
  fileName?: string;
  line: number;
  severity: string;
  message: string;
  impact?: string;
}

/**
 * Chat da sidebar — Q&A sobre erros já detectados, pedidos de correção direta (a IA reescreve
 * o arquivo e o usuário aplica com um clique), e o gatilho de "limpar a pasta inteira" (por
 * texto livre ou pelo botão). Histórico fica em memória no processo da extensão (sobrevive a
 * esconder/mostrar o painel), não é persistido em disco — só os ACHADOS vão pro cache permanente.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'shieldepy.chat';

  private view: vscode.WebviewView | undefined;
  private history: ChatTurn[] = [];

  constructor(
    private readonly anthropicService: AnthropicService,
    private readonly graphManager: GraphManager,
    private readonly findingsManager: FindingsManager,
    private readonly backgroundAnalyzer: BackgroundAnalyzer,
    private readonly output: vscode.OutputChannel
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.render();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'ready') {
        this.post({ type: 'history', turns: this.history });
      } else if (message?.type === 'send') {
        await this.handleSend(String(message.text ?? ''), Array.isArray(message.attachments) ? message.attachments : []);
      } else if (message?.type === 'applyFix') {
        await this.applyFix(String(message.filePath ?? ''), String(message.content ?? ''));
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /**
   * Chamado pelo ShieldepyViewProvider quando o usuário clica "Ask AI" num achado da lista —
   * não manda pergunta pronta sozinho, só ANEXA o erro na caixa de entrada (igual anexar uma
   * imagem num chat), pro usuário escrever a própria pergunta citando aquele erro.
   */
  attachFinding(finding: FindingAttachment): void {
    vscode.commands.executeCommand('shieldepy.chat.focus').then(
      () => this.post({ type: 'attach', finding }),
      (err) => this.output.appendLine(`[ChatViewProvider] falha ao focar o chat pra anexar achado: ${err}`)
    );
  }

  /** Chamado pelo comando de paleta "ShielDepy: Analisar Pasta Inteira" e pelo botão do chat. */
  async runFullScan(): Promise<void> {
    try {
      await vscode.commands.executeCommand('shieldepy.chat.focus');
      this.appendAssistant('🧹 Analisando todos os arquivos do workspace, um instante…');

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ShielDepy: analisando a pasta inteira',
          cancellable: true,
        },
        async (progress, token) => {
          return this.backgroundAnalyzer.scanWorkspace((fileName, index, total) => {
            progress.report({ message: `${fileName} (${index}/${total})` });
          }, token);
        }
      );

      const summary =
        result.totalFindings > 0
          ? `Analisei ${result.filesScanned} arquivo(s) e encontrei ${result.totalFindings} problema(s) no total. Os destaques coloridos já devem aparecer nos arquivos, e a lista "Problemas neste arquivo" atualiza ao abrir cada um.`
          : `Analisei ${result.filesScanned} arquivo(s) e não encontrei nenhum problema. 🎉`;

      this.appendAssistant(summary);
    } catch (err) {
      const msg = `Falha ao analisar a pasta: ${err instanceof Error ? err.message : err}`;
      this.output.appendLine(`[ChatViewProvider] ${msg}`);
      this.appendAssistant(msg);
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private appendAssistant(text: string): void {
    this.history.push({ role: 'assistant', text });
    this.post({ type: 'append', turn: { role: 'assistant', text } });
  }

  private async handleSend(text: string, attachments: FindingAttachment[] = []): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    const citedText = this.buildCitedMessage(trimmed, attachments);
    this.history.push({ role: 'user', text: citedText });
    this.post({ type: 'append', turn: { role: 'user', text: citedText } });
    this.post({ type: 'thinking', value: true });

    try {
      // Atalho: pedir pra "limpar"/"escanear" a pasta pelo texto livre também dispara a
      // varredura completa, sem precisar do botão.
      if (/\b(limpa|limpar|escane|escanear|varra|varrer)\b.*\bpasta\b/i.test(trimmed) || /\bscan\b.*\bfolder\b/i.test(trimmed)) {
        await this.runFullScan();
        return;
      }

      const targetUri = await this.resolveTargetUri(trimmed, attachments);
      const targetDoc = targetUri ? await this.safeOpenDocument(targetUri) : undefined;

      const activeFile = targetDoc
        ? { path: vscode.workspace.asRelativePath(targetDoc.uri), text: targetDoc.getText() }
        : undefined;
      const subgraph = targetDoc ? this.graphManager.getImpactSubgraph(targetDoc.uri.toString(), 2) : undefined;
      const findings = targetDoc
        ? this.findingsManager.get(targetDoc.uri).map((f) => ({
            id: f.id,
            line: f.range.start.line + 1,
            severity: f.severity,
            message: f.message,
            impact: f.impact,
          }))
        : undefined;

      const reply = await this.anthropicService.chat({
        // Correções antigas (FIXED_FILE) trazem o arquivo inteiro — reenviar isso em toda
        // mensagem futura cresce sem limite. Fica só a explicação no histórico; o arquivo já
        // foi aplicado (ou não) e o estado ATUAL do arquivo já vai fresco em `activeFile`.
        history: this.history.map((t) => ({
          role: t.role,
          content: t.role === 'assistant' ? this.stripFixedFileForHistory(t.text) : t.text,
        })),
        activeFile,
        subgraph,
        findings,
      });

      const finalReply = targetDoc ? await this.verifyAndImprove(reply, targetDoc) : reply;
      this.appendAssistant(finalReply);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      const msg = `Erro ao falar com o Claude: ${errorText}`;
      this.output.appendLine(`[ChatViewProvider] ${msg}`);
      this.appendAssistant(msg);

      if (errorText.includes('Chave da API não configurada')) {
        void vscode.window
          .showErrorMessage('ShielDepy: chave da API da Anthropic não configurada.', 'Configurar chave')
          .then((choice) => {
            if (choice === 'Configurar chave') void vscode.commands.executeCommand('shieldepy.setApiKey');
          });
      }
    } finally {
      this.post({ type: 'thinking', value: false });
    }
  }

  /**
   * Decide DE QUAL ARQUIVO puxar contexto pra essa mensagem: anexo explícito (clicou "Ask AI")
   * primeiro; senão, qualquer #id citado em texto livre (mesmo sem anexo — é o que garante
   * "o bot entende de qual erro está falando" mesmo sem o arquivo estar em foco); por último,
   * o editor ativo no momento. Sem isso, se o usuário digitar sobre um erro enquanto o foco
   * saiu do editor (ex: já está com o cursor na própria caixa do chat), `activeTextEditor` pode
   * vir undefined e o bot responde sem ver código nenhum.
   */
  private async resolveTargetUri(text: string, attachments: FindingAttachment[]): Promise<vscode.Uri | undefined> {
    if (attachments.length > 0) {
      try {
        return vscode.Uri.parse(attachments[0].uri);
      } catch (err) {
        this.output.appendLine(`[ChatViewProvider] URI de anexo inválida: ${err}`);
      }
    }

    for (const match of text.matchAll(/#([0-9a-f]{6,12})/gi)) {
      const entry = this.findingsManager.getById(match[1]);
      if (entry) return vscode.Uri.file(entry.file);
    }

    return vscode.window.activeTextEditor?.document.uri;
  }

  private async safeOpenDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      this.output.appendLine(`[ChatViewProvider] não consegui abrir ${uri.fsPath}: ${err}`);
      return undefined;
    }
  }

  /**
   * Depois de propor uma correção: verifica de verdade (grafo de graça + uma varredura paga)
   * se ela deixou passar ou criou risco novo — é o "consertei o vermelho, criei um amarelo"
   * que você viu acontecer. Se achar algo, pede pra IA corrigir de novo UMA vez, mostrando
   * exatamente o que ainda está errado, antes de qualquer coisa chegar até você. Custa 1-2
   * chamadas extras, só quando uma correção de verdade foi proposta — não em toda mensagem.
   */
  private async verifyAndImprove(reply: string, document: vscode.TextDocument): Promise<string> {
    const fix = this.parseFixedFile(reply);
    if (!fix) return reply;

    const relativePath = vscode.workspace.asRelativePath(document.uri);
    if (fix.filePath !== relativePath) return reply; // não é o arquivo que temos — não dá pra verificar com segurança

    const originalText = document.getText();

    try {
      const issues = await this.verifyFix(document.uri, fix.content, originalText);
      if (issues.length === 0) return reply;

      const retryReply = await this.anthropicService.chat({
        history: [
          ...this.history.map((t) => ({
            role: t.role,
            content: t.role === 'assistant' ? this.stripFixedFileForHistory(t.text) : t.text,
          })),
          { role: 'assistant' as const, content: this.stripFixedFileForHistory(reply) },
          {
            role: 'user' as const,
            content: `Sua correção anterior ainda deixa isto:\n${issues.map((i) => `- ${i}`).join('\n')}\nCorrija de novo, resolvendo isso também, sem desfazer o que já estava certo.`,
          },
        ],
        activeFile: { path: relativePath, text: fix.content },
        subgraph: this.graphManager.getImpactSubgraph(document.uri.toString(), 2),
        findings: [],
      });

      const retryFix = this.parseFixedFile(retryReply);
      if (!retryFix) return retryReply;

      // Segunda tentativa só recebe a checagem grátis (grafo) — não outra chamada paga, pra
      // não deixar o custo de "corrigir" crescer sem limite.
      const cyclesOnly = await this.checkForCycles(document.uri, retryFix.content, originalText);
      if (cyclesOnly.length === 0) return retryReply;

      return `${retryReply}\n\nAtenção: mesmo depois de revisar, ainda parece ficar: ${cyclesOnly.join('; ')}. Considere pedir pra tentar de outro jeito.`;
    } catch (err) {
      this.output.appendLine(`[ChatViewProvider] falha ao verificar/melhorar a correção: ${err}`);
      return reply;
    }
  }

  /** Verificação completa (grátis + uma chamada paga) contra o conteúdo PROPOSTO, sem tocar no arquivo real. */
  private async verifyFix(uri: vscode.Uri, proposedText: string, originalText: string): Promise<string[]> {
    const key = uri.toString();
    const issues: string[] = [];

    try {
      await this.graphManager.updateFile(uri, proposedText);

      const subgraph = this.graphManager.getImpactSubgraph(key, 2);
      const ownSymbols = subgraph.nodes.filter((n) => n.attributes.file === key);
      for (const sym of ownSymbols) {
        const cycle = this.graphManager.findCycleThrough(sym.id);
        if (cycle) issues.push(`ciclo de chamadas: ${cycle.map((id) => this.graphManager.getLabel(id)).join(' → ')}`);
      }

      const risks = await this.anthropicService.scanForRisks(proposedText, subgraph);
      for (const risk of risks) {
        if (risk.severity === 'error' || risk.severity === 'warning') {
          issues.push(`${risk.severity}: ${risk.message}`);
        }
      }
    } finally {
      await this.graphManager.updateFile(uri, originalText);
    }

    return issues;
  }

  /** Checagem grátis (só grafo, sem IA) — usada na segunda tentativa, pra não empilhar custo. */
  private async checkForCycles(uri: vscode.Uri, proposedText: string, originalText: string): Promise<string[]> {
    const key = uri.toString();
    try {
      await this.graphManager.updateFile(uri, proposedText);
      const subgraph = this.graphManager.getImpactSubgraph(key, 1);
      const ownSymbols = subgraph.nodes.filter((n) => n.attributes.file === key);
      const chains: string[] = [];
      for (const sym of ownSymbols) {
        const cycle = this.graphManager.findCycleThrough(sym.id);
        if (cycle) chains.push(cycle.map((id) => this.graphManager.getLabel(id)).join(' → '));
      }
      return chains;
    } finally {
      // Isso foi só uma simulação — o arquivo real não mudou, então o grafo tem que voltar
      // a refletir o conteúdo de verdade, não o proposto.
      await this.graphManager.updateFile(uri, originalText);
    }
  }

  private parseFixedFile(text: string): { filePath: string; content: string } | null {
    const marker = 'FIXED_FILE:';
    const idx = text.indexOf(marker);
    if (idx === -1) return null;

    const after = text.slice(idx + marker.length);
    const fenceStart = after.indexOf('```');
    if (fenceStart === -1) return null;

    const filePath = after.slice(0, fenceStart).trim();
    const rest = after.slice(fenceStart + 3);
    const firstNewline = rest.indexOf('\n');
    const body = firstNewline === -1 ? rest : rest.slice(firstNewline + 1);
    const fenceEnd = body.indexOf('```');
    const content = fenceEnd === -1 ? body : body.slice(0, fenceEnd);

    return { filePath, content };
  }

  /** Junta os anexos (erros citados, tipo anexar imagem num chat) na frente do texto digitado. */
  private buildCitedMessage(text: string, attachments: FindingAttachment[]): string {
    if (attachments.length === 0) return text;
    const citations = attachments
      .map((a) => `[#${a.id} · ${a.fileName ?? 'arquivo'}:${a.line + 1}] ${a.message}`)
      .join('\n');
    return text ? `${citations}\n\n${text}` : `${citations}\n\nComo eu resolvo isso?`;
  }

  private stripFixedFileForHistory(text: string): string {
    const idx = text.indexOf('FIXED_FILE:');
    if (idx === -1) return text;
    const explanation = text.slice(0, idx).trim();
    return explanation
      ? `${explanation} [correção de arquivo aplicada anteriormente — conteúdo omitido do histórico pra economizar tokens]`
      : '[correção de arquivo proposta anteriormente — conteúdo omitido do histórico pra economizar tokens]';
  }

  private async applyFix(filePath: string, content: string): Promise<void> {
    try {
      const base = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uri = path.isAbsolute(filePath) || !base ? vscode.Uri.file(filePath) : vscode.Uri.joinPath(base, filePath);

      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, content);
      const applied = await vscode.workspace.applyEdit(edit);
      await vscode.window.showTextDocument(uri, { preview: false });
      this.post({ type: 'fixApplied', ok: applied, filePath });
    } catch (err) {
      this.output.appendLine(`[ChatViewProvider] falha ao aplicar correção em ${filePath}: ${err}`);
      this.post({ type: 'fixApplied', ok: false, filePath });
    }
  }

  private render(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8" />
<style>
  :root { --sd-accent: #10ef7c; --sd-error: #f85149; --sd-warning: #eab308; --sd-info: #3fb950; }
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
  }
  body { display: flex; flex-direction: column; }
  #messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 2px; }
  /* Bot à esquerda, humano à direita — cada bloco (avatar+conteúdo) fica preso na sua borda,
     em vez de tudo alinhado no mesmo lado como uma transcrição de terminal. */
  .turn { display: flex; gap: 8px; padding: 8px 0; align-items: flex-start; max-width: 90%; }
  .turn.assistant { margin-right: auto; }
  .turn.user { margin-left: auto; flex-direction: row-reverse; }
  .avatar {
    width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; margin-top: 1px;
    display: flex; align-items: center; justify-content: center;
  }
  .avatar.assistant { background: var(--sd-accent); }
  .avatar.assistant svg { width: 10px; height: 10px; fill: #06210f; }
  .avatar.user { background: transparent; border: 1px solid var(--vscode-panel-border, var(--vscode-descriptionForeground)); }
  .turn-content { flex: 1; min-width: 0; padding-top: 2px; }
  .turn-content.assistant-bubble { background: rgba(16, 239, 124, 0.07); border-radius: 8px; padding: 8px 10px; margin-top: -2px; }
  .turn.user .turn-content { text-align: right; }
  .turn-text { font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word; }
  .apply-btn {
    margin-top: 8px; display: block; font-size: 11px; background: transparent;
    color: var(--sd-accent); border: 1px solid var(--sd-accent); border-radius: 2px; padding: 5px 8px; cursor: pointer;
  }
  .turn.user .apply-btn { margin-left: auto; }
  .apply-btn:hover { background: var(--sd-accent); color: #06210f; }
  .apply-btn:disabled { opacity: .5; cursor: default; background: transparent; color: var(--sd-accent); }
  /* align-items: flex-start (não center) + nowrap no texto: a frase digitando/apagando muda de
     largura o tempo todo, e se o ícone ficasse centralizado verticalmente pelo flex, o próprio
     texto quebrando de linha (ou não) empurrava o ícone pra cima/baixo a cada troca de frase.
     Com altura fixa e o texto nunca quebrando linha, o ícone fica sempre no mesmo lugar. */
  #thinking {
    display: none; align-items: flex-start; gap: 8px; font-size: 11px; color: var(--sd-accent);
    padding: 2px 10px 10px 38px; height: 18px; overflow: hidden;
  }
  #thinkingText { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .morph-shape {
    width: 16px; height: 16px; flex-shrink: 0; background: var(--sd-accent);
    animation: sd-morph 2.4s ease-in-out infinite;
  }
  /* Mesmas 4 formas (16 vértices cada) do indicador "Analisando" do outro painel — reaproveitadas
     aqui como prefixo do "pensando", pra manter a mesma identidade visual em todo o produto. */
  @keyframes sd-morph {
    0%, 100% { clip-path: polygon(50.0% 2.0%, 68.4% 5.7%, 83.9% 16.1%, 94.3% 31.6%, 98.0% 50.0%, 94.3% 68.4%, 83.9% 83.9%, 68.4% 94.3%, 50.0% 98.0%, 31.6% 94.3%, 16.1% 83.9%, 5.7% 68.4%, 2.0% 50.0%, 5.7% 31.6%, 16.1% 16.1%, 31.6% 5.7%); }
    25%  { clip-path: polygon(50.0% 2.0%, 58.7% 19.4%, 67.4% 36.7%, 76.0% 54.1%, 84.7% 71.5%, 93.4% 88.8%, 88.8% 98.0%, 69.4% 98.0%, 50.0% 98.0%, 30.6% 98.0%, 11.2% 98.0%, 6.6% 88.8%, 15.3% 71.5%, 24.0% 54.1%, 32.6% 36.7%, 41.3% 19.4%); }
    50%  { clip-path: polygon(50.0% 2.0%, 62.0% 14.0%, 74.0% 26.0%, 86.0% 38.0%, 98.0% 50.0%, 86.0% 62.0%, 74.0% 74.0%, 62.0% 86.0%, 50.0% 98.0%, 38.0% 86.0%, 26.0% 74.0%, 14.0% 62.0%, 2.0% 50.0%, 14.0% 38.0%, 26.0% 26.0%, 38.0% 14.0%); }
    75%  { clip-path: polygon(50.0% 0.0%, 57.7% 31.5%, 85.4% 14.6%, 68.5% 42.3%, 100.0% 50.0%, 68.5% 57.7%, 85.4% 85.4%, 57.7% 68.5%, 50.0% 100.0%, 42.3% 68.5%, 14.6% 85.4%, 31.5% 57.7%, 0.0% 50.0%, 31.5% 42.3%, 14.6% 14.6%, 42.3% 31.5%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .morph-shape { animation: none; clip-path: none; border-radius: 50%; }
  }
  .attachments-row { display: none; flex-wrap: wrap; gap: 6px; padding: 8px 8px 0; }
  .attachment-chip {
    display: flex; align-items: center; gap: 5px; font-size: 10px; line-height: 1.3;
    background: rgba(16, 239, 124, 0.1); border: 1px solid var(--sd-accent); color: var(--sd-accent);
    border-radius: 999px; padding: 3px 6px 3px 9px; max-width: 100%;
  }
  .attachment-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-chip button {
    background: none; border: none; color: inherit; cursor: pointer; font-size: 13px; line-height: 1;
    padding: 0; flex-shrink: 0;
  }
  #inputRow { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border, transparent); }
  #inputBox {
    flex: 1; resize: none; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 6px; font-family: inherit; font-size: 12px;
  }
  #sendBtn {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 2px; padding: 0 12px; cursor: pointer;
  }
  .empty-hint { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 10px 10px 10px 13px; }
</style>
</head>
<body>
  <div id="messages">
    <div class="empty-hint">Pergunte sobre um erro, peça uma correção, ou peça pra analisar a pasta inteira.</div>
  </div>
  <div id="thinking"><span class="morph-shape"></span><span id="thinkingText"></span></div>
  <div id="attachmentsRow" class="attachments-row"></div>
  <div id="inputRow">
    <textarea id="inputBox" rows="2" placeholder="Pergunte sobre um erro, peça uma correção…"></textarea>
    <button id="sendBtn">Enviar</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const inputBox = document.getElementById('inputBox');
  const sendBtn = document.getElementById('sendBtn');
  const thinkingEl = document.getElementById('thinking');
  const thinkingTextEl = document.getElementById('thinkingText');
  const attachmentsRow = document.getElementById('attachmentsRow');
  let attachments = [];

  const THINKING_PHRASES = [
    'misturando', 'processando', 'protegendo', 'canalizando', 'mapeando',
    'rastreando', 'decifrando', 'tecendo o grafo', 'conectando pontas', 'vasculhando', 'blindando'
  ];
  let thinkingActive = false;
  let thinkingTimer = null;

  function stopThinkingAnimation() {
    thinkingActive = false;
    if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
    thinkingTextEl.textContent = '';
  }

  function startThinkingAnimation() {
    if (thinkingActive) return;
    thinkingActive = true;
    let phraseIndex = Math.floor(Math.random() * THINKING_PHRASES.length);

    function typePhrase() {
      if (!thinkingActive) return;
      const phrase = THINKING_PHRASES[phraseIndex] + '…';
      let charIndex = 0;

      function typeChar() {
        if (!thinkingActive) return;
        charIndex++;
        thinkingTextEl.textContent = phrase.slice(0, charIndex);
        thinkingTimer = charIndex < phrase.length ? setTimeout(typeChar, 32) : setTimeout(erasePhrase, 750);
      }

      function erasePhrase() {
        if (!thinkingActive) return;
        charIndex--;
        thinkingTextEl.textContent = phrase.slice(0, charIndex);
        if (charIndex > 0) {
          thinkingTimer = setTimeout(erasePhrase, 18);
        } else {
          phraseIndex = (phraseIndex + 1) % THINKING_PHRASES.length;
          thinkingTimer = setTimeout(typePhrase, 150);
        }
      }

      typeChar();
    }

    typePhrase();
  }

  function parseAssistantMessage(text) {
    const marker = 'FIXED_FILE:';
    const idx = text.indexOf(marker);
    if (idx === -1) return { explanation: text, fix: null };

    const after = text.slice(idx + marker.length);
    const fenceStart = after.indexOf('\\u0060\\u0060\\u0060');
    if (fenceStart === -1) return { explanation: text, fix: null };

    const filePath = after.slice(0, fenceStart).trim();
    const rest = after.slice(fenceStart + 3);
    const firstNewline = rest.indexOf('\\n');
    const body = firstNewline === -1 ? rest : rest.slice(firstNewline + 1);
    const fenceEnd = body.indexOf('\\u0060\\u0060\\u0060');
    const content = fenceEnd === -1 ? body : body.slice(0, fenceEnd);
    // Texto depois do bloco de código (ex: aviso de possível regressão) não pode ser
    // descartado — junta com a explicação de cima, senão some da tela.
    const trailing = fenceEnd === -1 ? '' : body.slice(fenceEnd + 3).trim();
    const before = text.slice(0, idx).trim();
    const explanation = trailing ? (before ? before + '\\n\\n' + trailing : trailing) : before;

    return { explanation: explanation, fix: { filePath: filePath, content: content } };
  }

  function addTurn(role, text) {
    if (messagesEl.querySelector('.empty-hint')) messagesEl.innerHTML = '';

    const turn = document.createElement('div');
    turn.className = 'turn ' + role;

    const avatar = document.createElement('span');
    avatar.className = 'avatar ' + role;
    if (role === 'assistant') {
      avatar.innerHTML = '<svg viewBox="-143 0 2341 2341" xmlns="http://www.w3.org/2000/svg"><path d="M1968.64 1747.09L1027.07 2341L59.3685 1747.56L0 0.715702L1025.84 220.951L2055 0L1968.64 1747.09Z"/></svg>';
    }
    turn.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'turn-content' + (role === 'assistant' ? ' assistant-bubble' : '');

    if (role === 'assistant') {
      const parsed = parseAssistantMessage(text);
      const p = document.createElement('div');
      p.className = 'turn-text';
      p.textContent = parsed.explanation || text;
      content.appendChild(p);

      if (parsed.fix) {
        const btn = document.createElement('button');
        btn.className = 'apply-btn';
        btn.textContent = 'Aplicar correção em ' + parsed.fix.filePath;
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'applyFix', filePath: parsed.fix.filePath, content: parsed.fix.content });
          btn.disabled = true;
          btn.textContent = 'Aplicado';
        });
        content.appendChild(btn);
      }
    } else {
      const p = document.createElement('div');
      p.className = 'turn-text';
      p.textContent = text;
      content.appendChild(p);
    }

    turn.appendChild(content);
    messagesEl.appendChild(turn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addAttachment(finding) {
    if (attachments.some((a) => a.id === finding.id)) return;
    attachments.push(finding);
    renderAttachments();
    inputBox.focus();
  }

  function removeAttachment(id) {
    attachments = attachments.filter((a) => a.id !== id);
    renderAttachments();
  }

  function renderAttachments() {
    attachmentsRow.style.display = attachments.length ? 'flex' : 'none';
    attachmentsRow.innerHTML = '';
    for (const a of attachments) {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';

      const label = document.createElement('span');
      label.textContent = '#' + a.id + ' · ' + (a.fileName || '') + ':' + (a.line + 1);
      chip.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '\\u00d7';
      removeBtn.title = 'Remover anexo';
      removeBtn.addEventListener('click', () => removeAttachment(a.id));
      chip.appendChild(removeBtn);

      attachmentsRow.appendChild(chip);
    }
  }

  function send() {
    const text = inputBox.value;
    if (!text.trim() && attachments.length === 0) return;
    const sentAttachments = attachments;
    attachments = [];
    renderAttachments();
    inputBox.value = '';
    saveDraft();
    vscode.postMessage({ type: 'send', text: text, attachments: sentAttachments });
  }

  // Segunda camada de proteção pro rascunho não enviado: retainContextWhenHidden já cobre
  // esconder/mostrar a view, mas getState/setState sobrevive até um reload da janela inteira.
  function saveDraft() {
    vscode.setState({ draft: inputBox.value });
  }

  const savedState = vscode.getState();
  if (savedState && savedState.draft) inputBox.value = savedState.draft;
  inputBox.addEventListener('input', saveDraft);

  sendBtn.addEventListener('click', send);
  inputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'history') {
      messagesEl.innerHTML = '';
      if (!msg.turns || msg.turns.length === 0) {
        messagesEl.innerHTML = '<div class="empty-hint">Pergunte sobre um erro, peça uma correção, ou peça pra analisar a pasta inteira.</div>';
      } else {
        for (const turn of msg.turns) addTurn(turn.role, turn.text);
      }
    } else if (msg && msg.type === 'attach') {
      addAttachment(msg.finding);
    } else if (msg && msg.type === 'append') {
      addTurn(msg.turn.role, msg.turn.text);
    } else if (msg && msg.type === 'thinking') {
      thinkingEl.style.display = msg.value ? 'flex' : 'none';
      if (msg.value) startThinkingAnimation(); else stopThinkingAnimation();
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
