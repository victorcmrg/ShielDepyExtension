import { pool } from './db';
import { StripeGateway } from './gateways/StripeGateway';
import { OrderRepository, StockRepository } from './repositories';
import { CheckoutService } from './services';

export const checkoutService = new CheckoutService(
  new StockRepository(pool),
  new OrderRepository(pool),
  new StripeGateway(process.env.STRIPE_KEY ?? '')
);
