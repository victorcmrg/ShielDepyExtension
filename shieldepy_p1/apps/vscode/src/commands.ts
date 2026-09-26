// Implementação dos comandos da paleta que não pertencem a nenhuma view. O registro fica no
// extension.ts; aqui fica só o que cada comando faz.

import * as vscode from 'vscode';
import { explainCollisions, reviewChange, type DiagnosisReport } from '@shieldepy/agent';
import { toFileId } from '@shieldepy/core';
import { config } from './config';
import { CMD } from './constants';
import type { AiService } from './services/AiService';
import type { WorkspaceModel } from './workspace/WorkspaceModel';

/** "Configurar Chave da IA": escolhe o provedor e guarda a chave no Secret Storage. */
export async function setApiKey(ai: AiService): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Claude (Anthropic)', value: 'anthropic' as const, placeholder: 'sk-ant-...' },
      { label: 'Gemini (Google)', value: 'gemini' as const, placeholder: 'AIza...' },
    ],
    { title: 'ShielDepy: qual IA você quer configurar?' }
  );
  if (!pick) return;
  const key = await vscode.window.showInputBox({
    title: `ShielDepy: chave da API — ${pick.label}`,
    prompt: 'Fica salva criptografada no Secret Storage do VS Code, disponível em qualquer projeto.',
    placeHolder: pick.placeholder,
    password: true,
    ignoreFocusOut: true,
  });
  if (!key?.trim()) return;
  await ai.setKey(pick.value, key.trim());
  void vscode.window.showInformationMessage(`ShielDepy: chave de ${pick.label} salva com segurança.`);
}

/** "Explicar Colisões do Workspace": relatório declarativo (IA ou offline) em markdown. */
export async function explainWorkspaceCollisions(workspace: WorkspaceModel, ai: AiService, log: (m: string) => void): Promise<void> {
  const report = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'ShielDepy: explicando colisões…' },
    async () => explainCollisions(workspace.collisions(), workspace.rules, await ai.provider(), { log })
  );
  await showMarkdown(renderReport(report));
}

/** "Revisar Impacto no Grafo": revisão da IA do arquivo ativo + subgrafo + fatos provados. */
export async function reviewImpact(workspace: WorkspaceModel, ai: AiService): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== 'file') return;
  const provider = await ai.provider();
  if (!provider) {
    const choice = await vscode.window.showWarningMessage('ShielDepy: a revisão de impacto precisa de uma IA configurada.', 'Configurar chave');
    if (choice) void vscode.commands.executeCommand(CMD.setApiKey);
    return;
  }
  const id = toFileId(doc.uri.fsPath);
  workspace.updateFile(doc.uri.fsPath, doc.getText());
  const provenFacts = [
    ...workspace.graph.cyclesInFile(id).map((c) => `ciclo de chamadas: ${c.labels.join(' → ')}`),
    ...workspace.collisionsInvolving(id).map((c) => `colisão ${c.type} no campo "${c.field}" (${c.resource}/${c.event})`),
  ];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'ShielDepy: analisando subgrafo de impacto…' }, async () => {
    try {
      const md = await ai.run(() =>
        reviewChange(provider, {
          fileText: doc.getText(),
          filePath: vscode.workspace.asRelativePath(doc.uri),
          subgraph: workspace.graph.getImpactSubgraph(id, 2),
          language: config.languageName(),
          provenFacts,
        })
      );
      await showMarkdown(md);
    } catch (err) {
      void vscode.window.showErrorMessage(`ShielDepy: falha na revisão — ${err instanceof Error ? err.message : err}`);
    }
  });
}

function renderReport(report: DiagnosisReport): string {
  const lines = ['# Colisões do workspace', '', `_Texto gerado por: ${report.engine}_`, '', report.summary, ''];
  for (const d of report.diagnoses) {
    lines.push(
      `## ${d.severity} · ${d.affectedKey}`,
      '',
      `- **Status:** ${d.status} (confiança ${d.confidence}%)`,
      `- **Origens em conflito:** ${d.conflictingSources}`,
      `- **Causa raiz:** ${d.rootCause}`,
      `- **Recomendação:** ${d.recommendation}`,
      ''
    );
  }
  return lines.join('\n');
}

async function showMarkdown(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
