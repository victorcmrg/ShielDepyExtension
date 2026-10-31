import type { FastifyInstance } from 'fastify';
import { checkoutService } from '../container';
import { checkoutController } from '../controllers/CheckoutController';
import { validateCheckout } from '../hooks/validate';

/** As rotas do checkout, como plugin: o app.ts o registra com o prefixo /api. */
export async function checkoutRoutes(app: FastifyInstance) {
  app.post('/checkout', { preHandler: validateCheckout }, checkoutController.create);

  app.route({
    method: 'GET',
    url: '/orders/:id',
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const order = await checkoutService.find(id);
      if (!order) return reply.code(404).send();
      return order;
    },
  });
}
