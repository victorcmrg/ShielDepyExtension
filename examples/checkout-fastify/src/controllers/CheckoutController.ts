import type { FastifyReply, FastifyRequest } from 'fastify';
import { checkoutService } from '../container';
import { CheckoutService, OutOfStockError, type CheckoutInput } from '../services';

export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  create = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const order = await this.service.checkout(req.body as CheckoutInput);
      return reply.code(201).send(order);
    } catch (err) {
      if (err instanceof OutOfStockError) return reply.code(409).send({ error: 'sem estoque' });
      throw err;
    }
  };
}

export const checkoutController = new CheckoutController(checkoutService);
