import type { Charge, PaymentGateway } from './PaymentGateway';

/** Chamada ao Stripe SEM timeout e sem retry: se o Stripe travar, o request do cliente trava junto. */
export class StripeGateway implements PaymentGateway {
  constructor(private readonly apiKey: string) {}

  async charge(amountCents: number, token: string): Promise<Charge> {
    const response = await fetch('https://api.stripe.com/v1/charges', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: new URLSearchParams({ amount: String(amountCents), currency: 'brl', source: token }),
    });
    const body = await response.json();
    return { id: body.id, status: body.status };
  }
}
