# 0031 — O `reset` gerado grava um registro por tabela, lido do catálogo do banco

**Data:** 2026-11-03 (escolha técnica, na M1) · **Estado:** valendo

**Contexto.** O `--init` escrevia `1` no lugar de cada parâmetro de rota e marcava a linha como pendência, porque o `resetDb` gerado deixa o banco vazio: sem registro, `GET /orders/1` dá 404, o controle falha e o teste sai inválido. Os parâmetros eram a maior parte das pendências (6 de 7 no pg-crud, 11 de 11 no realworld, 5 de 6 no prisma-express), e o critério do MVP pede 1 ou 2.

**Decisão.**
- O `chaos/db.ts` gerado ganha um `seedDb()`, chamado no fim do `resetDb`, que grava **um registro em cada tabela**.
- As colunas vêm do **catálogo do banco já montado** (`information_schema` e `pg_constraint`), em tempo de execução, e não de uma leitura dos `.sql` no `--init`. Assim valem os `ALTER` das migrations, os enums e o esquema escrito à mão depois do `--init` (o pg-crud e o `checkout-express` não têm `.sql`).
- Os valores são fixos: id `1` (ou `'1'` num id de texto), texto `registro-1`, UUID `00000000-0000-4000-8000-000000000001`. A chave estrangeira copia o valor da coluna que ela referencia.
- `registro-1` é de propósito diferente dos valores dos corpos de exemplo ([0027](0027-corpo-de-exemplo-sem-pendencia.md)): senão o `POST` bateria no `UNIQUE` do registro e o controle falharia.
- Coluna `serial` ou identity não recebe valor: a sequência dá o 1, e o próximo `INSERT` do app sai 2. Com o 1 escrito à mão, esse `INSERT` daria conflito de chave, o que apareceria como um achado falso.
- Coluna opcional que não é texto nem chave fica vazia: um `deleted_at` preenchido esconderia o registro. A chave estrangeira opcional para a própria tabela também, para não criar um ciclo numa árvore.
- A inserção roda com `session_replication_role = replica`, que desliga os gatilhos das chaves estrangeiras: a ordem das tabelas e os ciclos entre elas deixam de importar. O papel volta ao normal mesmo se algo falhar.
- A tabela que recusa o registro (um `CHECK`, por exemplo) fica vazia, com um aviso no log. O resto segue: o controle das rotas dela é que dirá inválido.

**Consequências.**
- O contrato pode usar esses valores nos parâmetros sem pendência. Como na 0027, o registro não prova nada: quem decide é o controle do teste gerado.
- Os `chaos/db.ts` que já existem não mudam: o `--init` não sobrescreve. Os contratos do corpus (`scripts/dataset/contratos/`) continuam com os registros escritos à mão.
- O registro é genérico: não serve para login (a senha não é um hash) nem para regra de negócio (estoque, saldo). Esses dados continuam à mão, no `resetDb`.
