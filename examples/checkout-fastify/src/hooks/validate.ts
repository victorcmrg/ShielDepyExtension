import type { FastifyReply, FastifyRequest } from 'fastify';

/** preHandler da rota de checkout: o corpo precisa ter produto, quantidade, preço e cartão. */
export async function validateCheckout(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { productId, quantity, priceCents, cardToken } = (req.body ?? {}) as Record<string, any>;
  if (!productId || !cardToken || !(quantity > 0) || !(priceCents > 0)) {
    await reply.code(400).send({ error: 'pedido inválido' });
  }
}
