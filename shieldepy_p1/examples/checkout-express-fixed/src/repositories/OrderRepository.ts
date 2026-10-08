import type { Pool } from 'pg';

export interface Order {
  id: string;
  productId: string;
  quantity: number;
  chargeId: string;
}

export class OrderRepository {
  constructor(private readonly db: Pool) {}

  async insert(order: Omit<Order, 'id'>): Promise<Order> {
    const { rows } = await this.db.query(
      'INSERT INTO orders (product_id, quantity, charge_id) VALUES ($1, $2, $3) RETURNING id',
      [order.productId, order.quantity, order.chargeId]
    );
    return { id: rows[0].id, ...order };
  }

  async findById(id: string): Promise<Order | undefined> {
    const { rows } = await this.db.query('SELECT id, product_id AS "productId", quantity, charge_id AS "chargeId" FROM orders WHERE id = $1', [id]);
    return rows[0];
  }
}
