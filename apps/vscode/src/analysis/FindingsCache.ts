import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Finding } from '@shieldepy/core';

/** Achado depois de passar pelo cache — ganhou um #id estável e datas de primeira/última vez visto. */
export interface StoredFinding extends Finding {
  id: string;
  firstSeen: string;
  lastSeen: string;
}

interface CacheEntry extends StoredFinding {
  resolvedAt?: string;
}

const RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // resolvidos há mais de 30 dias saem do cache (item 4.3)
const MAX_ENTRIES = 5000;

/**
 * Cache permanente e invisível dos achados — vive na storage da própria extensão (nunca dentro
 * do projeto do usuário) e sobrevive a reinícios. Cada achado ganha um #id estável pra ser citado
 * no chat. Sem `vscode`: recebe o diretório e um logger.
 */
export class FindingsCache {
  private readonly filePath: string;
  private data: Record<string, CacheEntry> = {};
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly storageDir: string,
    private readonly log: (message: string) => void = () => {},
    private readonly now: () => Date = () => new Date()
  ) {
    this.filePath = path.join(storageDir, 'findings-cache.json');
  }

  async load(): Promise<void> {
    try {
      await mkdir(this.storageDir, { recursive: true });
      this.data = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch {
      this.data = {}; // primeiro uso, ou arquivo corrompido — começa vazio, nunca quebra a ativação
    }
    this.prune();
    this.flushTimer ??= setInterval(() => void this.flush(), 15000);
  }

  /** Atribui/reaproveita IDs estáveis pros achados atuais de um arquivo; marca os que sumiram como resolvidos. */
  record(fileId: string, findings: Finding[]): StoredFinding[] {
    const now = this.now().toISOString();
    const currentIds = new Set<string>();

    const stored = findings.map((f) => {
      const id = FindingsCache.stableId(fileId, f);
      currentIds.add(id);
      const existing = this.data[id];
      const entry: CacheEntry = { ...f, id, firstSeen: existing?.firstSeen ?? now, lastSeen: now };
      this.data[id] = entry;
      return entry;
    });

    for (const entry of Object.values(this.data)) {
      if (entry.file === fileId && !currentIds.has(entry.id) && !entry.resolvedAt) entry.resolvedAt = now;
    }

    this.dirty = true;
    return stored;
  }

  get(id: string): StoredFinding | undefined {
    return this.data[id];
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await writeFile(this.filePath, JSON.stringify(this.data), 'utf8');
    } catch (err) {
      this.log(`[FindingsCache] falha ao salvar cache: ${err}`);
    }
  }

  dispose(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = undefined;
    return this.flush();
  }

  /** Hash de arquivo + origem + `key` (ou mensagem, se não houver key). */
  static stableId(fileId: string, finding: Finding): string {
    return createHash('sha1')
      .update(`${fileId}::${finding.source}::${finding.key ?? finding.message}`)
      .digest('hex')
      .slice(0, 10);
  }

  private prune(): void {
    const cutoff = this.now().getTime() - RESOLVED_TTL_MS;
    for (const [id, entry] of Object.entries(this.data)) {
      if (entry.resolvedAt && Date.parse(entry.resolvedAt) < cutoff) delete this.data[id];
    }
    const entries = Object.values(this.data);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
      for (const e of entries.slice(0, entries.length - MAX_ENTRIES)) delete this.data[e.id];
    }
    this.dirty = true;
  }
}
