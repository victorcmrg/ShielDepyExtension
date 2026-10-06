import type * as vscode from 'vscode';
import { collisionsToFindings } from '@shieldepy/agent';
import type { Finding } from '@shieldepy/core';
import { isPathAllowed } from '../workspace/files';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import type { FindingsManager } from './FindingsManager';

/**
 * Mantém os achados de COLISÃO em dia. Uma colisão envolve dois arquivos — editar um pode criar
 * ou desfazer achados no outro — então isto reage a qualquer mudança de regra no workspace, não
 * ao arquivo editado. Grátis e determinístico (texto do explicador offline, sem IA).
 */
export class CollisionPublisher implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private publishedFiles = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly model: WorkspaceModel,
    private readonly findings: FindingsManager,
    private readonly isEnabled: () => boolean
  ) {
    this.unsubscribe = model.onDidChangeRules(() => this.schedule());
  }

  schedule(delayMs = 300): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.publish(), delayMs);
  }

  publish(): void {
    const byFile = new Map<string, Finding[]>();
    if (this.isEnabled()) {
      for (const f of collisionsToFindings(this.model.collisions(), this.model.rules)) {
        if (!isPathAllowed(f.file)) continue; // arquivo de um repositório não liberado pra pessoa
        byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
      }
    }
    for (const file of this.publishedFiles) if (!byFile.has(file)) this.findings.clear(file, 'colisao');
    for (const [file, list] of byFile) this.findings.set(file, 'colisao', list);
    this.publishedFiles = new Set(byFile.keys());
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.unsubscribe();
  }
}
