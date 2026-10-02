import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { config } from '../config';
import { SECRET_AUTH_TOKEN } from '../constants';

export interface AuthMe {
  email: string;
  companyId: number;
  companyName: string;
  permissions: Record<string, boolean>;
}

/**
 * O que a extensão pode fazer agora:
 *   loggedOut — ninguém entrou (ou o token foi revogado): tudo travado
 *   suspended — entrou, mas a empresa está com o acesso suspenso: tudo travado
 *   active    — pode usar; a IA ainda depende de `aiEnabled` à parte
 */
export type AccessState = 'loggedOut' | 'suspended' | 'active';

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
      })
    );
  }

  private webBaseUrl(): string {
    return config.webBaseUrl().replace(/\/$/, '');
  }

  /** Chame uma vez na ativação — carrega o /api/me inicial antes das views renderizarem. */
  async ensureLoaded(extensionId: string): Promise<void> {
    this.extensionAuthority = extensionId.toLowerCase();
    await this.fetchMe(true);
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
    return this.cachedMe.permissions.accessEnabled === false ? 'suspended' : 'active';
  }

  /** Síncrono — pra checar em todo evento de edição sem esperar rede (usa o último /api/me). */
  canUse(): boolean {
    return this.accessState() === 'active';
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

  /** Painel web da conta (o próprio site redireciona o admin pro painel admin). */
  async openDashboard(): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(`${this.webBaseUrl()}/account.html`));
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
    return me ? `${me.email}|${me.companyName}|${me.permissions.accessEnabled !== false}|${Boolean(me.permissions.aiEnabled)}` : 'out';
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
    return Boolean(me && me.permissions.accessEnabled !== false && me.permissions.aiEnabled);
  }

  async logout(): Promise<void> {
    const token = await this.secrets.get(SECRET_AUTH_TOKEN);
    await this.secrets.delete(SECRET_AUTH_TOKEN);
    this.cachedMe = null;
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
