import { PaymentError, type Charge, type PaymentGateway } from './PaymentGateway';

/** Tempo máximo esperando o Stripe: depois disso o cliente recebe 502, em vez de ficar pendurado. */
const STRIPE_TIMEOUT_MS = 5000;

/** Corrigido: chamada ao Stripe COM timeout, e qualquer falha dele vira `PaymentError`. */
export class StripeGateway implements PaymentGateway {
  constructor(private readonly apiKey: string) {}

  async charge(amountCents: number, token: string): Promise<Charge> {
    let response: Response;
    try {
      response = await fetch('https://api.stripe.com/v1/charges', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: new URLSearchParams({ amount: String(amountCents), currency: 'brl', source: token }),
        signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PaymentError(`Stripe indisponível: ${err}`);
    }
    if (!response.ok) throw new PaymentError(`Stripe respondeu ${response.status}`);
    const body = await response.json().catch(() => undefined);
    if (!body?.id) throw new PaymentError('resposta do Stripe inválida');
    return { id: body.id, status: body.status };
  }
}
