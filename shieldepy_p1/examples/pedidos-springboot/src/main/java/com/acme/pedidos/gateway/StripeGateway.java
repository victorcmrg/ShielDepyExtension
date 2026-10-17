package com.acme.pedidos.gateway;

import com.acme.pedidos.model.Charge;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/** Chamada ao Stripe sem retry; o timeout é o do RestTemplate (configurado fora daqui). */
@Component
public class StripeGateway implements PaymentGateway {
    private final RestTemplate rest;

    public StripeGateway(RestTemplate rest) {
        this.rest = rest;
    }

    @Override
    public Charge charge(int amountCents, String token) {
        var body = Map.of("amount", amountCents, "currency", "brl", "source", token);
        return rest.postForObject("https://api.stripe.com/v1/charges", body, Charge.class);
    }
}
