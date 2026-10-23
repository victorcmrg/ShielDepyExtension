import { Router } from 'express';
import { checkoutController } from '@/controllers/CheckoutController';
import { checkoutService } from '@/container';
import { validateCheckout } from '@/middleware/validate';

export const checkoutRouter = Router();

checkoutRouter.post('/checkout', validateCheckout, checkoutController.create);

checkoutRouter.get('/orders/:id', async (req, res) => {
  const order = await checkoutService.find(req.params.id);
  if (!order) res.status(404).end();
  else res.json(order);
});
