package com.acme.pedidos.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import lombok.Data;

@Data
@Entity
public class StockItem {
    @Id
    private String productId;
    private int quantity;
}
