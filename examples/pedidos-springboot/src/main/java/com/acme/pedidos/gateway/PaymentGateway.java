package com.acme.pedidos.gateway;

import com.acme.pedidos.model.Charge;

public interface PaymentGateway {
    Charge charge(int amountCents, String token);
}
