import { randomUUID } from 'node:crypto';
import type { Collision, Rule } from '@shieldepy/core';
import type { ChatMessage } from '@shieldepy/agent';

export interface Session {
  collisions: Collision[];
  rules: Rule[];
  history: ChatMessage[];
  lastUsed: number;
}

/**
 * Sessões de conversa em memória. Cada uma prende os FATOS provados + o histórico. Diferente do
 * MVP: expiram (TTL), têm teto de quantidade (a mais antiga sai) e de histórico — antes a memória
 * crescia sem limite e o histórico inteiro ia pra IA a cada mensagem.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly options = { ttlMs: 60 * 60 * 1000, maxSessions: 500, maxHistory: 40 },
    private readonly now: () => number = Date.now
  ) {}

  create(collisions: Collision[], rules: Rule[]): string {
    this.evict();
    if (this.sessions.size >= this.options.maxSessions) {
      const oldest = [...this.sessions].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    const id = randomUUID();
    this.sessions.set(id, { collisions, rules, history: [], lastUsed: this.now() });
    return id;
  }

  get(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (this.now() - s.lastUsed > this.options.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    s.lastUsed = this.now();
    return s;
  }

  append(id: string, ...turns: ChatMessage[]): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.history.push(...turns);
    if (s.history.length > this.options.maxHistory) s.history.splice(0, s.history.length - this.options.maxHistory);
  }

  get size(): number {
    return this.sessions.size;
  }

  private evict(): void {
    const now = this.now();
    for (const [id, s] of this.sessions) if (now - s.lastUsed > this.options.ttlMs) this.sessions.delete(id);
  }
}

/** Janela fixa por chave (IP): no máximo `limit` requisições por `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; start: number }>();

  constructor(
    private readonly limit = 30,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t - entry.start >= this.windowMs) {
      this.hits.set(key, { count: 1, start: t });
      if (this.hits.size > 10_000) this.hits.clear(); // teto de memória: zera a janela de todo mundo
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }
}
