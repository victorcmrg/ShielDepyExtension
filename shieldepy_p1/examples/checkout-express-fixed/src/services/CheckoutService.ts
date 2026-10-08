import type { Charge, PaymentGateway } from '@/gateways/PaymentGateway';
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
   * Corrigido: reserva o estoque ANTES de cobrar (UPDATE atômico) e, se a cobrança falhar, devolve
   * a reserva. Sem "lê, espera o Stripe, grava": não há janela para duas compras do mesmo item.
   */
  async checkout(input: CheckoutInput): Promise<Order> {
    const reserved = await this.stock.reserve(input.productId, input.quantity);
    if (!reserved) throw new OutOfStockError(input.productId);

    let charge: Charge;
    try {
      charge = await this.payments.charge(input.priceCents * input.quantity, input.cardToken);
    } catch (err) {
      await this.stock.release(input.productId, input.quantity);
      throw err;
    }
    return this.orders.insert({ productId: input.productId, quantity: input.quantity, chargeId: charge.id });
  }

  async find(id: string): Promise<Order | undefined> {
    return this.orders.findById(id);
  }
}
