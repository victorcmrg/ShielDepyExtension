import type { Request, Response } from 'express';
import { checkoutService } from '../container';
import { CheckoutService, OutOfStockError } from '../services';

export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const order = await this.service.checkout(req.body);
      res.status(201).json(order);
    } catch (err) {
      if (err instanceof OutOfStockError) res.status(409).json({ error: 'sem estoque' });
      else throw err;
    }
  };
}

export const checkoutController = new CheckoutController(checkoutService);
