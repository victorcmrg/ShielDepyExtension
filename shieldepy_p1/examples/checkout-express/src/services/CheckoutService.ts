import type { PaymentGateway } from '@/gateways/PaymentGateway';
import { OrderRepository, StockRepository, type Order } from '@/repositories';

export class OutOfStockError extends Error {}

export interface CheckoutInput {
  productId: string;
  quantity: number;
  priceCents: number;
  cardToken: string;
}

export class CheckoutService {
  constructor(
    private readonly stock: StockRepository,
    private readonly orders: OrderRepository,
    private readonly payments: PaymentGateway
  ) {}

  /**
   * RACE CONDITION proposital: lê o estoque, espera o Stripe e só depois decrementa — sem
   * transação nem `SELECT ... FOR UPDATE`. Duas compras simultâneas do último item passam.
   */
  async checkout(input: CheckoutInput): Promise<Order> {
    const available = await this.stock.available(input.productId);
    if (available < input.quantity) throw new OutOfStockError(input.productId);

    const charge = await this.payments.charge(input.priceCents * input.quantity, input.cardToken);
    await this.stock.decrement(input.productId, input.quantity);
    return this.orders.insert({ productId: input.productId, quantity: input.quantity, chargeId: charge.id });
  }

  async find(id: string): Promise<Order | undefined> {
    return this.orders.findById(id);
  }
}
