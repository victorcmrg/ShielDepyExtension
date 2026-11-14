// "Perguntar à IA" num achado: o chat abre e o achado entra anexado na caixa de mensagem. Na primeira
// vez o painel do chat ainda não existe: o focusChat o cria, mas o script dele só escuta depois de
// mandar "ready", e o VS Code descarta o que for postado antes. O anexo tem que esperar o "ready".
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ onFocus: (): void => {} }));

vi.mock('vscode', () => ({
  Uri: { joinPath: (...parts: unknown[]) => ({ fsPath: parts.join('/'), toString: () => parts.join('/') }), file: (p: string) => ({ fsPath: p }) },
  commands: {
    executeCommand: vi.fn(async (cmd: string) => {
      if (cmd === 'shieldepy.chat.focus') state.onFocus();
    }),
  },
  workspace: {
    getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    workspaceFolders: [],
  },
  window: { activeTextEditor: undefined },
}));

import { ChatViewProvider, type FindingAttachment } from '../src/chat/ChatViewProvider';

function fakeView() {
  let receive: (m: unknown) => Promise<void> | void = () => {};
  const posted: { type: string; [k: string]: unknown }[] = [];
  const view = {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (u: unknown) => u,
      postMessage: vi.fn(async (m: { type: string }) => {
        posted.push(m);
        return true;
      }),
      onDidReceiveMessage: (cb: typeof receive) => {
        receive = cb;
        return { dispose() {} };
      },
    },
    onDidDispose: () => ({ dispose() {} }),
  };
  return { view, posted, send: (m: unknown) => receive(m) };
}

const auth = { onDidChangeAuth: () => ({ dispose() {} }), companyAiBlock: () => null, getCachedMe: () => null, folderAccess: () => [] };
const finding: FindingAttachment = { id: 'f1', ref: 3, fileId: '/w/src/a.ts', fileName: 'a.ts', line: 9, message: 'ciclo entre regras' };
const flush = () => new Promise((r) => setTimeout(r, 0));

function provider() {
  return new ChatViewProvider({ fsPath: '/ext' } as never, {} as never, {} as never, {} as never, {} as never, auth as never, () => {});
}

describe('anexar um achado no chat', () => {
  beforeEach(() => {
    state.onFocus = () => {};
  });

  it('na primeira vez (o chat ainda não existe), o achado espera o painel ficar pronto e chega depois do histórico', async () => {
    const chat = provider();
    const v = fakeView();
    // o focusChat faz o VS Code criar o painel agora; o script dele ainda não carregou
    state.onFocus = () => chat.resolveWebviewView(v.view as never);
    chat.attachFinding(finding);
    await flush();
    expect(v.posted.filter((m) => m.type === 'attach')).toEqual([]);

    await v.send({ type: 'ready' });
    const types = v.posted.map((m) => m.type);
    expect(types).toContain('attach');
    expect(types.indexOf('attach')).toBeGreaterThan(types.indexOf('history'));
    expect(v.posted.find((m) => m.type === 'attach')?.finding).toEqual(finding);
  });

  it('com o chat já aberto, o achado vai na hora, uma vez só', async () => {
    const chat = provider();
    const v = fakeView();
    chat.resolveWebviewView(v.view as never);
    await v.send({ type: 'ready' });
    chat.attachFinding(finding);
    await flush();
    expect(v.posted.filter((m) => m.type === 'attach')).toHaveLength(1);
    // um "ready" novo (o HTML remontado) não reenvia o que já foi entregue
    await v.send({ type: 'ready' });
    expect(v.posted.filter((m) => m.type === 'attach')).toHaveLength(1);
  });
});
