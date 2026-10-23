package com.acme.pedidos.service;

import com.acme.pedidos.gateway.PaymentGateway;
import com.acme.pedidos.model.CheckoutRequest;
import com.acme.pedidos.model.Order;
import com.acme.pedidos.model.StockItem;
import com.acme.pedidos.repository.OrderRepository;
import com.acme.pedidos.repository.StockRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CheckoutService {
    private final StockRepository stock;
    private final OrderRepository orders;
    private final PaymentGateway payments;

    /**
     * RACE CONDITION proposital: lê o estoque, espera o Stripe e só depois baixa — sem @Transactional.
     * Se o banco cair depois da cobrança, o cliente paga e o pedido não é gravado.
     */
    public Order checkout(CheckoutRequest input) {
        StockItem item = stock.findById(input.productId()).orElseThrow(() -> new OutOfStockException(input.productId()));
        if (item.getQuantity() < input.quantity()) throw new OutOfStockException(input.productId());

        var charge = payments.charge(input.priceCents() * input.quantity(), input.cardToken());
        item.setQuantity(item.getQuantity() - input.quantity());
        stock.save(item);

        var order = new Order();
        order.setProductId(input.productId());
        order.setQuantity(input.quantity());
        order.setChargeId(charge.id());
        return orders.save(order);
    }

    public Optional<Order> find(Long id) {
        return orders.findById(id);
    }
}
