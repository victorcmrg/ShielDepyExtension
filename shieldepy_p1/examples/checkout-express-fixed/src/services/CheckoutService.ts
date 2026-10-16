import type { Charge, PaymentGateway } from '@/gateways/PaymentGateway';
import { OrderRepository, StockRepository, type Order } from '@/repositories';

export class OutOfStockError extends Error {}

/** O pedido não foi gravado depois de cobrar; a cobrança foi estornada (ou o estorno ficou pendente). */
export class OrderNotSavedError extends Error {
  constructor(
    readonly chargeId: string,
    readonly refunded: boolean,
    cause: unknown
  ) {
    super(`pedido não gravado (cobrança ${chargeId} ${refunded ? 'estornada' : 'com estorno pendente'})`, { cause });
  }
}

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
   * Se o pedido não puder ser gravado DEPOIS de cobrar (o banco caiu), compensa: estorna a cobrança
   * e devolve a reserva. Sem isso, o cliente ficaria cobrado sem pedido (o achado do DB_Chaos).
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
    try {
      return await this.orders.insert({ productId: input.productId, quantity: input.quantity, chargeId: charge.id });
    } catch (err) {
      const refunded = await this.payments.refund(charge.id).then(
        () => true,
        () => false // estorno pendente: fica no erro para alguém reconciliar
      );
      await this.stock.release(input.productId, input.quantity).catch(() => undefined);
      throw new OrderNotSavedError(charge.id, refunded, err);
    }
  }

  async find(id: string): Promise<Order | undefined> {
    return this.orders.findById(id);
  }
}
