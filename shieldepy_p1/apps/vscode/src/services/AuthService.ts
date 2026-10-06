import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import * as path from 'node:path';
import { config } from '../config';
import { SECRET_AUTH_TOKEN } from '../constants';
import { findRepos, type WorkspaceRepo } from '../workspace/gitRemotes';

export interface AuthMe {
  email: string;
  companyId: number;
  companyName: string;
  permissions: Record<string, boolean>;
}

/**
 * O que a extensão pode fazer agora:
 *   loggedOut   — ninguém entrou (ou o token foi revogado): tudo travado
 *   suspended   — entrou, mas a empresa está com o acesso suspenso: tudo travado
 *   repoBlocked — conta ok, mas nenhum repositório aberto está num projeto da pessoa
 *                 (o servidor reconhece o repositório pelo remote do .git)
 *   active      — pode usar, nos repositórios liberados; a IA ainda depende de `aiEnabled`
 */
export type AccessState = 'loggedOut' | 'suspended' | 'repoBlocked' | 'active';

/** Resultado da checagem de uma pasta aberta: liberada (e por qual projeto) ou não, e por quê. */
export interface FolderAccess extends WorkspaceRepo {
  allowed: boolean;
  project: { id: number; name: string } | null;
}

const ME_CACHE_TTL_MS = 20_000; // curto de propósito — revogação/toggle de admin surte efeito rápido
const RECHECK_INTERVAL_MS = 60_000; // sem nenhuma chamada de IA, ainda assim percebe a suspensão em até 1 min
const LOGIN_CEREMONY_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingLogin {
  state: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Login via navegador (device flow, estilo `gh auth login`): login() abre o device-confirm.html
 * do site; o navegador confirma e redireciona pra vscode://<publisher>.<name>/callback, que o
 * registerUriHandler em extension.ts encaminha pra completeLogin(). O token fica no Secret Storage.
 *
 * `accessState()` é o gate da extensão INTEIRA (análise, colisões, chat, comandos);
 * `hasAiAccess()` é o gate só da IA, consultado por AiService.provider().
 */
export class AuthService implements vscode.Disposable {
  private readonly onDidChangeAuthEmitter = new vscode.EventEmitter<AccessState>();
  /** Dispara quando o estado de acesso (ou a permissão de IA) MUDA — não a cada rechecagem. */
  readonly onDidChangeAuth = this.onDidChangeAuthEmitter.event;

  private extensionAuthority = 'shieldepy.shieldepy';
  private cachedMe: AuthMe | null = null;
  private cacheLoaded = false;
  private cachedAt = 0;
  private lastSignature = '';
  private pendingLogin: PendingLogin | undefined;
  /** Última checagem das pastas abertas (null = ainda não checou). */
  private folders: FolderAccess[] | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly recheckTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly log: (message: string) => void
  ) {
    this.recheckTimer = setInterval(() => void this.refresh(), RECHECK_INTERVAL_MS);
    this.disposables.push(
      // Voltou pra janela: rechecagem imediata (a suspensão pode ter acontecido enquanto estava fora).
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) void this.refresh();
      }),
      secrets.onDidChange((e) => {
        if (e.key === SECRET_AUTH_TOKEN) void this.refresh();
      }),
      // Abriu/fechou pasta no workspace: o repositório (e a liberação) pode ter mudado.
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh())
    );
  }

  private webBaseUrl(): string {
    return config.webBaseUrl().replace(/\/$/, '');
  }

  /** Chame uma vez na ativação — carrega o /api/me inicial antes das views renderizarem. */
  async ensureLoaded(extensionId: string): Promise<void> {
    this.extensionAuthority = extensionId.toLowerCase();
    await this.fetchMe(true);
    await this.checkRepos();
    this.lastSignature = this.signature();
  }

  get uriAuthority(): string {
    return this.extensionAuthority;
  }

  getCachedMe(): AuthMe | null {
    return this.cachedMe;
  }

  isLoggedIn(): boolean {
    return this.cachedMe !== null;
  }

  accessState(): AccessState {
    if (!this.cachedMe) return 'loggedOut';
    if (this.cachedMe.permissions.accessEnabled === false) return 'suspended';
    return this.folders?.some((f) => f.allowed) ? 'active' : 'repoBlocked';
  }

  /** Síncrono — pra checar em todo evento de edição sem esperar rede (usa o último /api/me). */
  canUse(): boolean {
    return this.accessState() === 'active';
  }

  /** As pastas abertas e se cada uma está liberada — a tela de bloqueio mostra qual repositório falta. */
  folderAccess(): FolderAccess[] {
    return this.folders ?? [];
  }

  /** O arquivo está numa pasta liberada? (multi-root: só as pastas dos projetos da pessoa são analisadas) */
  isAllowedPath(fsPath: string): boolean {
    return (this.folders ?? []).some((f) => {
      if (!f.allowed) return false;
      const rel = path.relative(f.folder, fsPath);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  }

  /**
   * Pergunta ao servidor se os repositórios abertos (pelo remote do .git) estão em projetos da
   * pessoa — e, quando estão, o servidor registra o uso (o painel web mostra "em uso por …").
   * Falha de rede mantém a última resposta, igual ao /api/me.
   */
  private async checkRepos(): Promise<void> {
    if (!this.cachedMe || this.cachedMe.permissions.accessEnabled === false) return;
    const token = await this.secrets.get(SECRET_AUTH_TOKEN);
    if (!token) return;
    const repos = await findRepos((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath));
    const withRemote = repos.filter((r) => r.remote);
    try {
      const answer =
        withRemote.length === 0
          ? { repos: [] as Array<{ allowed: boolean; project: { id: number; name: string } | null }> }
          : ((await (
              await fetch(`${this.webBaseUrl()}/api/repos/check`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ repos: withRemote.map((r) => ({ remote: r.remote, branch: r.branch })) }),
              })
            ).json()) as { repos?: Array<{ allowed: boolean; project: { id: number; name: string } | null }> });
      const results = answer.repos ?? [];
      this.folders = repos.map((r) => {
        const i = withRemote.indexOf(r);
        const res = i >= 0 ? results[i] : undefined;
        return { ...r, allowed: Boolean(res?.allowed), project: res?.project ?? null };
      });
    } catch (err) {
      this.log(`[AuthService] falha ao checar os repositórios: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Abre o navegador no device-confirm.html; a promise resolve quando completeLogin() confirmar. */
  async login(): Promise<void> {
    if (this.pendingLogin) {
      clearTimeout(this.pendingLogin.timer);
      this.pendingLogin.reject(new Error('um novo login foi iniciado'));
    }

    const state = randomBytes(16).toString('base64url');
    const url = `${this.webBaseUrl()}/device-confirm.html?state=${encodeURIComponent(state)}`;

    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingLogin?.state === state) this.pendingLogin = undefined;
        reject(new Error('login expirou — clique em "Entrar" de novo'));
      }, LOGIN_CEREMONY_TIMEOUT_MS);
      this.pendingLogin = { state, resolve, reject, timer };
    });

    await vscode.env.openExternal(vscode.Uri.parse(url));
    return promise;
  }

  /** Painel web: os projetos da pessoa (é lá que o dono conecta repositórios e equipe). */
  async openDashboard(): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(`${this.webBaseUrl()}/projects.html`));
  }

  /** Chamado pelo registerUriHandler em extension.ts quando o navegador volta pro vscode://.../callback. */
  async completeLogin(code: string, state: string): Promise<void> {
    if (!this.pendingLogin || this.pendingLogin.state !== state) {
      this.log('[AuthService] callback recebido com state desconhecido ou expirado — ignorado.');
      return;
    }

    const pending = this.pendingLogin;
    this.pendingLogin = undefined;
    clearTimeout(pending.timer);

    try {
      const res = await fetch(`${this.webBaseUrl()}/api/auth/device/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, label: `${hostname()} · ${vscode.env.appName}` }),
      });
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) throw new Error(body.error ?? 'falha ao trocar o código pelo token');

      await this.secrets.store(SECRET_AUTH_TOKEN, body.token);
      await this.refresh();
      pending.resolve();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log(`[AuthService] falha ao completar login: ${error.message}`);
      pending.reject(error);
    }
  }

  /**
   * Só pro teste E2E (exposto apenas em ExtensionMode.Test): grava um token já emitido, pulando o
   * navegador. Não libera nada sozinho — o acesso continua sendo decidido pelo /api/me do servidor.
   */
  async signInWithToken(token: string): Promise<AccessState> {
    await this.secrets.store(SECRET_AUTH_TOKEN, token);
    return this.refresh();
  }

  /** Rebusca o /api/me ignorando o cache e avisa quem escuta SE algo mudou. */
  async refresh(): Promise<AccessState> {
    await this.fetchMe(true);
    await this.checkRepos();
    const sig = this.signature();
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.log(`[AuthService] acesso agora: ${this.accessState()}${this.cachedMe ? ` (${this.cachedMe.companyName})` : ''}`);
      this.onDidChangeAuthEmitter.fire(this.accessState());
    }
    return this.accessState();
  }

  private signature(): string {
    const me = this.cachedMe;
    // Pastas liberadas fazem parte: o dono conectar/desconectar o repositório muda o estado na hora.
    const allowed = (this.folders ?? [])
      .filter((f) => f.allowed)
      .map((f) => f.folder)
      .join(',');
    return me ? `${me.email}|${me.companyName}|${me.permissions.accessEnabled !== false}|${Boolean(me.permissions.aiEnabled)}|${allowed}` : 'out';
  }

  /** Único ponto que fala com GET /api/me. Cache curto — force=true ignora o cache. */
  async fetchMe(force = false): Promise<AuthMe | null> {
    if (!force && this.cacheLoaded && Date.now() - this.cachedAt < ME_CACHE_TTL_MS) {
      return this.cachedMe;
    }

    const token = await this.secrets.get(SECRET_AUTH_TOKEN);
    if (!token) {
      this.cachedMe = null;
      this.cacheLoaded = true;
      this.cachedAt = Date.now();
      return null;
    }

    try {
      const res = await fetch(`${this.webBaseUrl()}/api/me`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        // Token revogado (admin removeu, usuário desconectou pelo painel): volta a pedir login.
        await this.secrets.delete(SECRET_AUTH_TOKEN);
        this.cachedMe = null;
      } else if (res.ok) {
        this.cachedMe = (await res.json()) as AuthMe;
      } else {
        this.log(`[AuthService] /api/me respondeu ${res.status}`);
      }
    } catch (err) {
      // Servidor fora do ar: mantém o último estado conhecido em vez de travar quem já estava usando.
      this.log(`[AuthService] falha ao buscar /api/me: ${err instanceof Error ? err.message : err}`);
    }

    this.cacheLoaded = true;
    this.cachedAt = Date.now();
    return this.cachedMe;
  }

  /** true = acesso ativo e a empresa liberou `aiEnabled`. Consultado só por AiService.provider(). */
  async hasAiAccess(): Promise<boolean> {
    const me = await this.fetchMe();
    return Boolean(me && me.permissions.aiEnabled && this.accessState() === 'active');
  }

  async logout(): Promise<void> {
    const token = await this.secrets.get(SECRET_AUTH_TOKEN);
    await this.secrets.delete(SECRET_AUTH_TOKEN);
    this.cachedMe = null;
    this.folders = null;
    this.cacheLoaded = true;
    this.cachedAt = Date.now();
    this.lastSignature = this.signature();
    this.onDidChangeAuthEmitter.fire('loggedOut');

    if (token) {
      try {
        await fetch(`${this.webBaseUrl()}/api/auth/logout-device`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort — o token local já foi removido de qualquer forma
      }
    }
  }

  dispose(): void {
    clearInterval(this.recheckTimer);
    for (const d of this.disposables) d.dispose();
    this.onDidChangeAuthEmitter.dispose();
  }
}
