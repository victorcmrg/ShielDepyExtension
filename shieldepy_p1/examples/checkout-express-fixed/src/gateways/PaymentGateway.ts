export interface Charge {
  id: string;
  status: 'succeeded' | 'failed';
}

export interface PaymentGateway {
  charge(amountCents: number, token: string): Promise<Charge>;
}

/** O provedor de pagamento falhou (fora do ar, lento demais, resposta inválida): a compra não aconteceu. */
export class PaymentError extends Error {}
