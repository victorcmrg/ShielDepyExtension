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
