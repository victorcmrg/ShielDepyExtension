-- O projeto não tem .sql de esquema: escreva aqui os CREATE TABLE (o chaos/db.ts aplica este arquivo).
-- Tabelas que o mapa viu o app usar: category, product.
CREATE TABLE category (id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_date TIMESTAMP);
CREATE TABLE product (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, price NUMERIC, currency TEXT, quantity INT, active BOOLEAN, category_id INT REFERENCES category (id), created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_date TIMESTAMP);
