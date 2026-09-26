import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { GraphManager } from '../../src/graph/GraphManager';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** `GraphManager` real, com as gramáticas `.wasm` de verdade — nada de parser falso. */
export async function createGraph(): Promise<GraphManager> {
  const output = (vscode.window as any).createOutputChannel('test');
  const graph = new GraphManager(output);
  await graph.initialize({ extensionPath: PROJECT_ROOT } as any);
  return graph;
}

/** Diretório temporário com arquivos de fixture escritos em disco (o resolver de import consulta o disco). */
export class Fixture {
  readonly dir: string;

  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-'));
  }

  write(relPath: string, content: string): vscode.Uri {
    const full = path.join(this.dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return vscode.Uri.file(full);
  }

  uri(relPath: string): vscode.Uri {
    return vscode.Uri.file(path.join(this.dir, relPath));
  }

  cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Escreve o arquivo no disco e já atualiza o grafo com o conteúdo. */
export async function indexFile(graph: GraphManager, fx: Fixture, relPath: string, content: string): Promise<vscode.Uri> {
  const uri = fx.write(relPath, content);
  await graph.updateFile(uri, content);
  return uri;
}

type Snapshot = ReturnType<GraphManager['getImpactSubgraph']>;

/** Acha o id do nó de símbolo pelo nome (dentro de um arquivo, se informado). */
export function symbolId(graph: GraphManager, name: string, fileUri?: vscode.Uri): string {
  const snap = fullSnapshot(graph, fileUri);
  const node = snap.nodes.find(
    (n) => n.attributes.name === name && (!fileUri || n.attributes.file === fileUri.toString())
  );
  if (!node) throw new Error(`símbolo "${name}" não encontrado no grafo`);
  return node.id;
}

export function hasEdge(graph: GraphManager, source: string, target: string, type: string): boolean {
  const g = (graph as any).graph;
  if (!g.hasNode(source) || !g.hasNode(target)) return false;
  return g.edges(source, target).some((e: string) => g.getEdgeAttribute(e, 'type') === type);
}

/** Snapshot do grafo inteiro (ou do subgrafo do arquivo, com profundidade grande). */
export function fullSnapshot(graph: GraphManager, fileUri?: vscode.Uri): Snapshot {
  const g = (graph as any).graph;
  if (fileUri) return graph.getImpactSubgraph(fileUri.toString(), 10);
  return {
    nodes: g.mapNodes((id: string, attributes: Record<string, unknown>) => ({ id, attributes })),
    edges: [],
  };
}

export function nodeAttributes(graph: GraphManager, id: string): Record<string, unknown> | undefined {
  const g = (graph as any).graph;
  return g.hasNode(id) ? g.getNodeAttributes(id) : undefined;
}
