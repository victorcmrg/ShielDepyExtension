# pedidos-springboot — o checkout em Spring Boot (exemplo da etapa J)

O mesmo checkout do `checkout-express` e do `pedidos-aspnet`, em Java com Spring Boot e Spring Data
JPA, com os mesmos defeitos plantados. Não precisa compilar nem rodar: o ShielDepy só lê o código.

| Onde | O quê | Defeito |
|---|---|---|
| `web/CheckoutController.java` | `POST /api/checkout` e `GET /api/orders/{id}` (`@RequestMapping` + `@PostMapping`/`@GetMapping`) | — |
| `service/CheckoutService.java` | lê o estoque, cobra no Stripe, baixa o estoque e grava o pedido | corrida no estoque (sem `@Transactional`) e falha parcial (cobra e não grava) |
| `gateway/StripeGateway.java` | `RestTemplate.postForObject` para `api.stripe.com` | — |
| `repository/*Repository.java` | Spring Data JPA (`JpaRepository<T, ID>`) | — |
