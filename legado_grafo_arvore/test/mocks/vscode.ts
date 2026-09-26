// Stub mínimo da API do VS Code para rodar o código da extensão em Node puro (Vitest).
// Implementa só o que o código de produção usa; o resto fica de fora de propósito, pra um
// uso novo não coberto falhar alto em vez de passar silenciosamente.
import * as nodePath from 'path';

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string
  ) {}

  static file(fsPath: string): Uri {
    let p = nodePath.resolve(fsPath).replace(/\\/g, '/');
    if (!p.startsWith('/')) p = '/' + p;
    // Igual ao VS Code: letra de drive minúscula, pra ids de arquivo baterem independente da origem.
    p = p.replace(/^\/([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}:`);
    return new Uri('file', p);
  }

  static parse(value: string): Uri {
    const match = /^([a-z][\w+.-]*):\/\/(.*)$/i.exec(value);
    if (!match) throw new Error(`Uri.parse: valor inválido "${value}"`);
    return new Uri(match[1], decodeURIComponent(match[2]));
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, nodePath.posix.join(base.path, ...segments));
  }

  get fsPath(): string {
    const p = /^\/[a-z]:/i.test(this.path) ? this.path.slice(1) : this.path;
    return nodePath.normalize(p);
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  with(change: { scheme?: string; path?: string }): Uri {
    return new Uri(change.scheme ?? this.scheme, change.path ?? this.path);
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startOrLine: Position | number, endOrChar: Position | number, endLine?: number, endChar?: number) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, endOrChar as number);
      this.end = new Position(endLine ?? startOrLine, endChar ?? 0);
    } else {
      this.start = startOrLine;
      this.end = endOrChar as Position;
    }
  }
}

export class Selection extends Range {}

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();
  readonly event = (listener: (e: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) l(e);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class CancellationTokenSource {
  private emitter = new EventEmitter<void>();
  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event,
  };
  cancel(): void {
    if (this.token.isCancellationRequested) return;
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
  dispose(): void {
    this.emitter.dispose();
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  code?: string | number;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: DiagnosticSeverity
  ) {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class FileDecoration {
  constructor(
    readonly badge?: string,
    readonly tooltip?: string,
    readonly color?: ThemeColor
  ) {}
}

export class MarkdownString {
  value = '';
  isTrusted = false;
  constructor(value?: string) {
    this.value = value ?? '';
  }
  appendMarkdown(s: string): this {
    this.value += s;
    return this;
  }
}

export class InlineCompletionItem {
  constructor(
    readonly insertText: string,
    readonly range?: Range
  ) {}
}

export enum InlineCompletionTriggerKind {
  Invoke = 0,
  Automatic = 1,
}

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
  Full = 7,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export class WorkspaceEdit {
  readonly edits: Array<{ uri: Uri; range: Range; text: string }> = [];
  replace(uri: Uri, range: Range, text: string): void {
    this.edits.push({ uri, range, text });
  }
}

/** Valores de configuração controláveis pelos testes: `__config['shieldepy.language'] = 'en-US'`. */
export const __config: Record<string, unknown> = {};

export const workspace = {
  workspaceFolders: undefined as Array<{ uri: Uri; name: string; index: number }> | undefined,
  getConfiguration(section?: string) {
    return {
      get<T>(key: string, defaultValue?: T): T {
        const full = section ? `${section}.${key}` : key;
        return (full in __config ? __config[full] : defaultValue) as T;
      },
      async update(key: string, value: unknown): Promise<void> {
        __config[section ? `${section}.${key}` : key] = value;
      },
    };
  },
  asRelativePath(uriOrPath: Uri | string): string {
    const fsPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath;
    const folder = workspace.workspaceFolders?.[0];
    if (!folder) return fsPath;
    const rel = nodePath.relative(folder.uri.fsPath, fsPath);
    return rel.startsWith('..') ? fsPath : rel.replace(/\\/g, '/');
  },
  findFiles: async (): Promise<Uri[]> => [],
  openTextDocument: async (_uri: Uri): Promise<unknown> => {
    throw new Error('workspace.openTextDocument não está mockado neste teste');
  },
  applyEdit: async (): Promise<boolean> => true,
  onDidChangeConfiguration: new EventEmitter<unknown>().event,
};

export const window = {
  visibleTextEditors: [] as unknown[],
  activeTextEditor: undefined as unknown,
  onDidChangeVisibleTextEditors: new EventEmitter<unknown[]>().event,
  onDidChangeActiveTextEditor: new EventEmitter<unknown>().event,
  createTextEditorDecorationType: (_opts: unknown) => ({ dispose() {} }),
  createOutputChannel: (_name: string) => createOutputChannel(),
  showErrorMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showTextDocument: async () => undefined,
  setStatusBarMessage: () => ({ dispose() {} }),
  withProgress: async <T>(_opts: unknown, task: (p: unknown, t: unknown) => Promise<T>) =>
    task({ report() {} }, new CancellationTokenSource().token),
};

export const languages = {
  createDiagnosticCollection: (_name: string) => {
    const map = new Map<string, Diagnostic[]>();
    return {
      set: (uri: Uri, diags: Diagnostic[]) => map.set(uri.toString(), diags),
      delete: (uri: Uri) => map.delete(uri.toString()),
      get: (uri: Uri) => map.get(uri.toString()),
      dispose: () => map.clear(),
    };
  },
};

export const commands = {
  executeCommand: async (..._args: unknown[]) => undefined,
  registerCommand: (_id: string, _fn: unknown) => ({ dispose() {} }),
};

/** OutputChannel que guarda as linhas — os testes podem inspecionar o log. */
export function createOutputChannel() {
  const lines: string[] = [];
  return {
    lines,
    name: 'test',
    appendLine: (s: string) => lines.push(s),
    append: (s: string) => lines.push(s),
    clear: () => (lines.length = 0),
    show() {},
    hide() {},
    dispose() {},
    replace() {},
  };
}
