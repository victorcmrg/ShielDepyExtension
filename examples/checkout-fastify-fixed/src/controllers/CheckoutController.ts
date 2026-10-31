import type { FastifyReply, FastifyRequest } from 'fastify';
import { checkoutService } from '../container';
import { PaymentError } from '../gateways/PaymentGateway';
import { CheckoutService, OrderNotSavedError, OutOfStockError, type CheckoutInput } from '../services';

export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  create = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const order = await this.service.checkout(req.body as CheckoutInput);
      return reply.code(201).send(order);
    } catch (err) {
      if (err instanceof OutOfStockError) return reply.code(409).send({ error: 'sem estoque' });
      if (err instanceof PaymentError) return reply.code(502).send({ error: 'pagamento indisponível' });
      if (err instanceof OrderNotSavedError) return reply.code(502).send({ error: 'pedido não gravado', refunded: err.refunded });
      throw err;
    }
  };
}

export const checkoutController = new CheckoutController(checkoutService);
