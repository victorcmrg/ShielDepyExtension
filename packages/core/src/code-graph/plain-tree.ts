// Cópia da árvore do Tree-sitter em objetos JavaScript comuns, feita num só percurso com o cursor.
//
// Por quê: no web-tree-sitter, cada acesso a um nó (`.type`, `.parent`, `.namedChildren`,
// `.childForFieldName`…) atravessa a fronteira com o WASM e cria objetos novos. A extração do
// TypeScript percorre cada árvore várias vezes (símbolos, chamadas, hashes, corpos das funções) e
// passava a maior parte do tempo nesse vaivém. Aqui cada nó é lido uma vez; depois, tudo é acesso a
// objeto. A cópia tem a mesma interface que a extração usa e o mesmo conteúdo (o teste
// `plain-tree.test.ts` compara nó por nó com a árvore real).
import type { SyntaxNode } from './parser';

interface Point {
  row: number;
  column: number;
}

/** O "tree" da cópia: só o que a extração pede (`node.tree.rootNode`) e uma identidade por árvore. */
export interface PlainTreeRef {
  rootNode: PlainNode;
}

export class PlainNode {
  readonly children: PlainNode[] = [];
  private named?: PlainNode[];
  private fields?: Map<string, PlainNode>;

  constructor(
    readonly type: string,
    readonly isNamed: boolean,
    readonly startIndex: number,
    readonly endIndex: number,
    readonly startPosition: Point,
    readonly endPosition: Point,
    readonly parent: PlainNode | null,
    readonly id: number,
    readonly tree: PlainTreeRef,
    private readonly source: string,
    private readonly base: number
  ) {}

  /** O texto do nó (o mesmo trecho que o Tree-sitter devolve). */
  get text(): string {
    return this.source.slice(this.startIndex - this.base, this.endIndex - this.base);
  }

  get namedChildren(): PlainNode[] {
    return (this.named ??= this.children.filter((c) => c.isNamed));
  }

  get childCount(): number {
    return this.children.length;
  }

  get nextNamedSibling(): PlainNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    for (let i = siblings.indexOf(this) + 1; i < siblings.length; i++) if (siblings[i]!.isNamed) return siblings[i]!;
    return null;
  }

  childForFieldName(name: string): PlainNode | null {
    return this.fields?.get(name) ?? null;
  }

  /** Liga um filho (com o campo dele, se houver: vale o primeiro, como no Tree-sitter). */
  adopt(child: PlainNode, field: string | null | undefined): void {
    this.children.push(child);
    if (!field) return;
    this.fields ??= new Map();
    if (!this.fields.has(field)) this.fields.set(field, child);
  }
}

/** A árvore inteira de `root` copiada (todos os nós, nomeados e anônimos, com os campos). */
export function plainTree(root: SyntaxNode): SyntaxNode {
  const source = root.text;
  const base = root.startIndex;
  const ref = {} as PlainTreeRef;
  let next = 0;
  const cursor = root.walk();
  try {
    const make = (parent: PlainNode | null) =>
      new PlainNode(cursor.nodeType, cursor.nodeIsNamed, cursor.startIndex, cursor.endIndex, cursor.startPosition, cursor.endPosition, parent, ++next, ref, source, base);
    const top = make(null);
    ref.rootNode = top;
    if (cursor.gotoFirstChild()) {
      let parent: PlainNode | null = top;
      outer: for (;;) {
        const node = make(parent);
        parent!.adopt(node, cursor.currentFieldName);
        if (cursor.gotoFirstChild()) {
          parent = node;
          continue;
        }
        while (!cursor.gotoNextSibling()) {
          cursor.gotoParent();
          parent = parent!.parent;
          if (!parent) break outer;
        }
      }
    }
    return top as unknown as SyntaxNode;
  } finally {
    cursor.delete();
  }
}
