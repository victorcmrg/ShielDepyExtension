import type { Request, Response } from 'express';
import { checkoutService } from '../container';
import { PaymentError } from '../gateways/PaymentGateway';
import { CheckoutService, OrderNotSavedError, OutOfStockError } from '../services';

export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const order = await this.service.checkout(req.body);
      res.status(201).json(order);
    } catch (err) {
      if (err instanceof OutOfStockError) res.status(409).json({ error: 'sem estoque' });
      else if (err instanceof PaymentError) res.status(502).json({ error: 'pagamento indisponível' });
      else if (err instanceof OrderNotSavedError) res.status(502).json({ error: 'pedido não gravado', refunded: err.refunded });
      else throw err;
    }
  };
}

export const checkoutController = new CheckoutController(checkoutService);
