import type { NextFunction, Request, Response } from 'express';

export function validateCheckout(req: Request, res: Response, next: NextFunction): void {
  const { productId, quantity, priceCents, cardToken } = req.body ?? {};
  if (!productId || !cardToken || !(quantity > 0) || !(priceCents > 0)) {
    res.status(400).json({ error: 'pedido inválido' });
    return;
  }
  next();
}
