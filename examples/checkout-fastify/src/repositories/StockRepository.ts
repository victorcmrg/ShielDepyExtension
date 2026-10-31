import type { Pool } from 'pg';

export class StockRepository {
  constructor(private readonly db: Pool) {}

  async available(productId: string): Promise<number> {
    const { rows } = await this.db.query('SELECT quantity FROM stock WHERE product_id = $1', [productId]);
    return rows[0]?.quantity ?? 0;
  }

  async decrement(productId: string, amount: number): Promise<void> {
    await this.db.query('UPDATE stock SET quantity = quantity - $2 WHERE product_id = $1', [productId, amount]);
  }
}
