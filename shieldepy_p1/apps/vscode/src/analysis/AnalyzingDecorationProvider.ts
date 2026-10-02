import * as vscode from 'vscode';

const FRAME_MS = 350;
// O VS Code não tem "ícone animado" de verdade pra itens do Explorer — a API de decoration
// (FileDecorationProvider) só aceita um badge de até 2 caracteres + uma cor, sem SVG/CSS.
// A animação é trocar o glifo a cada quadro, usando as mesmas formas da severidade.
// Nada de estrela/emoji: glifos com variante emoji ignoram a cor e apareciam brancos.
const FRAMES = ['●', '▲', '■'];

/**
 * Sabe QUAIS arquivos o BackgroundAnalyzer está processando agora e em que quadro da animação
 * cada um está — `start`/`stop` são chamados no início/fim de cada `analyze()`. Quem desenha no
 * Explorer é o ExplorerDecorations, que junta isto com os achados num badge só.
 */
export class AnalyzingDecorationProvider implements vscode.Disposable {
  /** Mudou o quadro (ou começou/parou) de um arquivo — o Explorer redesenha esse item. */
  private readonly frameEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeFrame = this.frameEmitter.event;

  // Evento "começou/parou de analisar esse arquivo" — o painel e a status bar escutam este.
  private readonly analyzingEmitter = new vscode.EventEmitter<{ uri: vscode.Uri; analyzing: boolean }>();
  readonly onDidChangeAnalyzing = this.analyzingEmitter.event;

  private readonly active = new Map<string, { uri: vscode.Uri; frame: number; timer: ReturnType<typeof setInterval> }>();

  start(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.active.has(key)) return;

    const timer = setInterval(() => {
      const state = this.active.get(key);
      if (!state) return;
      state.frame = (state.frame + 1) % FRAMES.length;
      this.frameEmitter.fire(state.uri);
    }, FRAME_MS);

    this.active.set(key, { uri, frame: 0, timer });
    this.frameEmitter.fire(uri);
    this.analyzingEmitter.fire({ uri, analyzing: true });
  }

  stop(uri: vscode.Uri): void {
    const key = uri.toString();
    const state = this.active.get(key);
    if (!state) return;
    clearInterval(state.timer);
    this.active.delete(key);
    this.frameEmitter.fire(uri);
    this.analyzingEmitter.fire({ uri, analyzing: false });
  }

  isAnalyzing(uri: vscode.Uri): boolean {
    return this.active.has(uri.toString());
  }

  /** Glifo do quadro atual, ou undefined se o arquivo não está sendo analisado. */
  frameOf(uri: vscode.Uri): string | undefined {
    const state = this.active.get(uri.toString());
    return state ? FRAMES[state.frame] : undefined;
  }

  dispose(): void {
    for (const state of this.active.values()) clearInterval(state.timer);
    this.active.clear();
    this.frameEmitter.dispose();
    this.analyzingEmitter.dispose();
  }
}
