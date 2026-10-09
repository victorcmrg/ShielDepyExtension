// Implementação dos comandos da paleta que não pertencem a nenhuma view. O registro fica no
// extension.ts; aqui fica só o que cada comando faz.

import * as vscode from 'vscode';
import { explainCollisions, reviewChange, type DiagnosisReport } from '@shieldepy/agent';
import { buildSystemGraph, buildTopology, canonicalJson, toFileId, type TopologyGraph } from '@shieldepy/core';
import { config } from './config';
import { CMD } from './constants';
import { t } from './i18n';
import type { AiService } from './services/AiService';
import type { AuthService } from './services/AuthService';
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

/** "Entrar": abre o navegador no device-confirm; espera a confirmação de "Confiar". */
export async function login(auth: AuthService): Promise<void> {
  try {
    await auth.login();
    void vscode.window.showInformationMessage(t('nLoginDone'));
  } catch (err) {
    void vscode.window.showErrorMessage(t('nLoginFailed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

/** "Rechecar acesso": força o /api/me (e a checagem do repositório) e diz o resultado. */
export async function refreshAccess(auth: AuthService): Promise<void> {
  const state = await auth.refresh();
  const text = { active: t('nAccessActive'), suspended: t('nAccessSuspended'), loggedOut: t('nAccessOut'), repoBlocked: t('nAccessRepo') }[state];
  vscode.window.setStatusBarMessage(text, 4000);
}

/** "Sair": revoga o token de dispositivo e limpa o Secret Storage. */
export async function logout(auth: AuthService): Promise<void> {
  await auth.logout();
  void vscode.window.showInformationMessage(t('nLoggedOut'));
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

/** Onde a topologia exportada fica, relativo à raiz do workspace (o mesmo caminho que a CLI usa no plano). */
export const TOPOLOGY_FILE = ['.shieldepy', 'topology-graph.json'] as const;

/**
 * "Exportar Topologia": grava `.shieldepy/topology-graph.json` com o grafo e as regras que já estão
 * em memória (sem reindexar nada). O aviso não é aguardado — quem chama (inclusive o E2E) recebe a
 * topologia na hora; "Abrir arquivo" e "Ver rotas no mapa" ficam como atalho.
 */
export async function exportTopology(workspace: WorkspaceModel, showMap: () => void): Promise<TopologyGraph | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage('ShielDepy: abra uma pasta para exportar a topologia.');
    return undefined;
  }
  const root = folder.uri.fsPath;
  const topology = buildTopology(workspace.graph, buildSystemGraph(workspace.graph, workspace.rules, root), root);
  const target = vscode.Uri.joinPath(folder.uri, ...TOPOLOGY_FILE);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, TOPOLOGY_FILE[0]));
  await vscode.workspace.fs.writeFile(target, Buffer.from(canonicalJson(topology, 2) + '\n', 'utf8'));

  const s = topology.stats;
  const partial = s.callsHeuristic + s.callsUnresolved > 0 ? ' O mapa tem chamadas não provadas: parte do percurso pode estar faltando.' : '';
  void vscode.window
    .showInformationMessage(
      `ShielDepy: ${s.routes} rota(s), ${s.sensitiveRoutes} sensível(is), ${s.operations} operação(ões) de I/O → ${TOPOLOGY_FILE.join('/')}.${partial}`,
      'Abrir arquivo',
      'Ver rotas no mapa'
    )
    .then(async (pick) => {
      if (pick === 'Abrir arquivo') await vscode.window.showTextDocument(target);
      else if (pick === 'Ver rotas no mapa') showMap();
    });
  return topology;
}

async function showMarkdown(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
