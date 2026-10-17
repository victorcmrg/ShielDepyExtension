package com.acme.pedidos.web;

import com.acme.pedidos.model.CheckoutRequest;
import com.acme.pedidos.model.Order;
import com.acme.pedidos.service.CheckoutService;
import com.acme.pedidos.service.OutOfStockException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class CheckoutController {
    private final CheckoutService service;

    public CheckoutController(CheckoutService service) {
        this.service = service;
    }

    @PostMapping("/checkout")
    public ResponseEntity<Order> create(@RequestBody CheckoutRequest input) {
        try {
            return ResponseEntity.status(HttpStatus.CREATED).body(service.checkout(input));
        } catch (OutOfStockException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
    }

    @GetMapping("/orders/{id}")
    public ResponseEntity<Order> get(@PathVariable Long id) {
        return service.find(id).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }
}
