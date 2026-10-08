import type { Pool } from 'pg';

export class StockRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Reserva atômica: um único UPDATE que só baixa se houver estoque. Não existe janela entre ler e
   * escrever — duas compras simultâneas do último item disputam a mesma linha, e só uma consegue.
   */
  async reserve(productId: string, amount: number): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE stock SET quantity = quantity - $2 WHERE product_id = $1 AND quantity >= $2', [productId, amount]);
    return (rowCount ?? 0) === 1;
  }

  /** Devolve o que foi reservado (a cobrança falhou). */
  async release(productId: string, amount: number): Promise<void> {
    await this.db.query('UPDATE stock SET quantity = quantity + $2 WHERE product_id = $1', [productId, amount]);
  }
}
