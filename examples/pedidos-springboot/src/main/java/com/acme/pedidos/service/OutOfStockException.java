package com.acme.pedidos.service;

public class OutOfStockException extends RuntimeException {
    public OutOfStockException(String productId) {
        super(productId);
    }
}
