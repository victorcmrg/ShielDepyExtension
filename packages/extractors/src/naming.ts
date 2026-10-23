// Convenções de nome de evento/recurso, compartilhadas pelos extratores. Operam sobre NOMES já
// extraídos da AST (não sobre código), então bastam operações de string.

const RESOURCE_SUFFIXES = [
  'Updated', 'Created', 'Deleted', 'Paid', 'Changed',
  'Removed', 'Added', 'Placed', 'Cancelled', 'Canceled',
  'Atualizado', 'Criado', 'Removido', 'Pago', 'Alterado', 'Cancelado',
];

/** Deriva o recurso de um nome de evento (ex.: "OrderUpdated" -> "Order", "PedidoAtualizado" -> "Pedido"). */
export function deriveResource(event: string): string {
  for (const s of RESOURCE_SUFFIXES) {
    if (event.endsWith(s) && event.length > s.length) return event.slice(0, -s.length);
  }
  return event;
}

/** Recurso de um evento com separador (ex.: "order.updated" / "order:updated" -> "order"). */
export function prefixResource(event: string): string {
  for (let i = 0; i < event.length; i++) {
    const ch = event[i];
    if (ch === '.' || ch === ':' || ch === '/') return i > 0 ? event.slice(0, i) : event;
  }
  return event;
}

export function decap(s: string): string {
  return s.length ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** Último segmento de um nome qualificado: `com.x.OrderUpdated` → `OrderUpdated`. */
export function lastSegment(qualified: string): string {
  const at = qualified.lastIndexOf('.');
  return at < 0 ? qualified : qualified.slice(at + 1);
}

/** Conjunto de campos lidos/escritos, já ordenado. */
export class FieldAccess {
  private readonly readSet = new Set<string>();
  private readonly writeSet = new Set<string>();

  read(field: string): void {
    this.readSet.add(field);
  }

  write(field: string): void {
    this.writeSet.add(field);
  }

  result(map: (field: string) => string = (f) => f): { reads: string[]; writes: string[] } {
    return { reads: [...this.readSet].map(map).sort(), writes: [...this.writeSet].map(map).sort() };
  }
}
