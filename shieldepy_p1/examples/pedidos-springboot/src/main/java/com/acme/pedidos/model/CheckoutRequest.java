package com.acme.pedidos.model;

public record CheckoutRequest(String productId, int quantity, int priceCents, String cardToken) { }
