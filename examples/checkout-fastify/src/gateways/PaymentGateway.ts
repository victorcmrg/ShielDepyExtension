export interface Charge {
  id: string;
  status: 'succeeded' | 'failed';
}

export interface PaymentGateway {
  charge(amountCents: number, token: string): Promise<Charge>;
}
