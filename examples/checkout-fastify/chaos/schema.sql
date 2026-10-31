-- O projeto não tem .sql de esquema: escreva aqui os CREATE TABLE (o chaos/db.ts aplica este arquivo).
-- Tabelas que o mapa viu o app usar: orders, stock.
CREATE TABLE stock (product_id TEXT PRIMARY KEY, quantity INTEGER NOT NULL);
CREATE TABLE orders (id SERIAL PRIMARY KEY, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, charge_id TEXT NOT NULL);
