import * as vscode from 'vscode';

const FRAME_MS = 350;
// O VS Code não tem "ícone animado" de verdade pra itens do Explorer — a API de decoration
// (FileDecorationProvider) só aceita um badge de até 2 caracteres + uma cor, sem SVG/CSS.
// Isso é um teto da API pública, não corrigível por código (o morph de verdade que pedimos
// mora no painel da sidebar, onde controlamos o HTML/CSS por completo).
//
// Formas originais restauradas (círculo/triângulo/losango/estrela). O deslocamento de centro
// que apareceu antes é território de métrica de fonte — cada glifo Unicode tem uma caixa de
// desenho própria, e o VS Code não expõe nenhum jeito de forçar centralização própria pra
// badge; o máximo que dá pra controlar daqui é não empilhar modificadores desnecessários.
// Por isso o seletor de "apresentação em texto" (︎) fica SÓ na estrela, que é a única
// com risco real de cair no estilo emoji colorido — nas outras três, adicionar o mesmo
// modificador não resolve nada e só é mais uma variável que pode pesar diferente por fonte.
const FRAMES = ['●', '▲', '◆', '✴︎'];

/**
 * Badge no Explorer (e em qualquer outra lista de arquivos do VS Code) enquanto o
 * BackgroundAnalyzer está processando aquele arquivo — `start`/`stop` são chamados
 * pelo BackgroundAnalyzer no início/fim de cada `analyze()`.
 */
export class AnalyzingDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  // Evento próprio (não o contrato do FileDecorationProvider) pra quem quiser saber
  // "começou/parou de analisar esse arquivo" sem precisar reimplementar a lógica de
  // decoration — é o que o painel da sidebar usa pro indicador com morph de verdade.
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
      this.emitter.fire(state.uri);
    }, FRAME_MS);

    this.active.set(key, { uri, frame: 0, timer });
    this.emitter.fire(uri);
    this.analyzingEmitter.fire({ uri, analyzing: true });
  }

  stop(uri: vscode.Uri): void {
    const key = uri.toString();
    const state = this.active.get(key);
    if (!state) return;
    clearInterval(state.timer);
    this.active.delete(key);
    this.emitter.fire(uri);
    this.analyzingEmitter.fire({ uri, analyzing: false });
  }

  isAnalyzing(uri: vscode.Uri): boolean {
    return this.active.has(uri.toString());
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const state = this.active.get(uri.toString());
    if (!state) return undefined;

    return new vscode.FileDecoration(
      FRAMES[state.frame],
      'ShielDepy está analisando este arquivo',
      // Cor NATIVA do VS Code (parte da paleta oficial de "charts"), não uma cor contribuída
      // por nós — passa por um caminho de renderização que o próprio VS Code garante, sem
      // depender de configuração nenhuma do usuário nem de ajuste de contraste específico
      // pra cores de terceiros.
      new vscode.ThemeColor('charts.green')
    );
  }

  dispose(): void {
    for (const state of this.active.values()) clearInterval(state.timer);
    this.active.clear();
    this.emitter.dispose();
    this.analyzingEmitter.dispose();
  }
}
