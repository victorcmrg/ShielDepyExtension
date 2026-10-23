package com.acme.pedidos.repository;

import com.acme.pedidos.model.StockItem;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StockRepository extends JpaRepository<StockItem, String> { }
