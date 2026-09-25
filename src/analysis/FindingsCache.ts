import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Finding, StoredFinding } from './types';

interface CacheEntry extends StoredFinding {
  file: string;
  resolvedAt?: string;
}

/**
 * Cache permanente e invisível dos achados — vive na pasta de storage da própria extensão
 * (nunca dentro do projeto do usuário, então não aparece no Explorer nem precisa de .gitignore),
 * e sobrevive a reinícios do VS Code. Cada achado ganha um ID estável (hash de arquivo + origem +
 * mensagem), pra poder ser referenciado depois no chat ("explica o erro #a1b2c3") mesmo que a
 * extensão tenha sido reiniciada nesse meio-tempo.
 */
export class FindingsCache {
  private readonly filePath: string;
  private data: Record<string, CacheEntry> = {};
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly storageDir: string, private readonly output: vscode.OutputChannel) {
    this.filePath = path.join(storageDir, 'findings-cache.json');
  }

  async load(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = {}; // primeiro uso, ou arquivo corrompido — começa vazio, nunca quebra a ativação
    }
    this.flushTimer = setInterval(() => void this.flush(), 15000);
  }

  /** Atribui/reaproveita IDs estáveis pros achados atuais de um arquivo, marca os que sumiram como resolvidos. */
  record(uri: vscode.Uri, findings: Finding[]): StoredFinding[] {
    const filePath = uri.fsPath;
    const now = new Date().toISOString();
    const currentIds = new Set<string>();

    const stored = findings.map((f) => {
      const id = this.stableId(filePath, f);
      currentIds.add(id);
      const existing = this.data[id];
      const entry: CacheEntry = {
        ...f,
        id,
        file: filePath,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
      };
      this.data[id] = entry;
      return entry;
    });

    for (const entry of Object.values(this.data)) {
      if (entry.file === filePath && !currentIds.has(entry.id) && !entry.resolvedAt) {
        entry.resolvedAt = now;
      }
    }

    this.dirty = true;
    return stored;
  }

  get(id: string): CacheEntry | undefined {
    return this.data[id];
  }

  all(): CacheEntry[] {
    return Object.values(this.data);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.data), 'utf8');
    } catch (err) {
      this.output.appendLine(`[FindingsCache] falha ao salvar cache: ${err}`);
    }
  }

  dispose(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    void this.flush();
  }

  private stableId(filePath: string, finding: Finding): string {
    const hash = crypto.createHash('sha1');
    hash.update(`${filePath}::${finding.source}::${finding.message}`);
    return hash.digest('hex').slice(0, 10);
  }
}
