# Teste de caos guiado pelo mapa

Para cada rota sensível, o ShielDepy gera testes que injetam falhas e prova o que quebra:

- a API externa demora (**timeout**), responde 5xx ou devolve um corpo inválido;
- duas requisições chegam ao mesmo tempo (**corrida**: vender o mesmo item duas vezes).

Cada teste roda primeiro **sem** a falha (o controle). Só conta como problema quando o controle passou e o caos quebrou.

**Na primeira vez**, o ShielDepy cria o `shieldepy.chaos.config.ts` a partir do mapa, já com as rotas e as APIs. Você completa só o que vier marcado com `TODO(shieldepy)`:

- como subir o app sem abrir porta;
- como zerar o estado entre um teste e outro;
- um corpo válido para cada rota.

Os testes usam o Vitest do seu projeto, com `supertest` e `msw`. Se faltar algum, o ShielDepy mostra o comando para instalar.
