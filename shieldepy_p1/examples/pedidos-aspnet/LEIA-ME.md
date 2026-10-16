# pedidos-aspnet — o checkout em ASP.NET Core (exemplo da etapa L)

O mesmo checkout do `checkout-express`, em C#, com os mesmos defeitos plantados, para provar que o
mapa (símbolos, chamadas, rotas e I/O) funciona fora do JS/TS. Não precisa compilar nem rodar: o
ShielDepy só lê o código.

| Onde | O quê | Defeito |
|---|---|---|
| `Controllers/CheckoutController.cs` | `POST /api/checkout` (atributos `[Route]` + `[HttpPost]`) | — |
| `Program.cs` | `GET /api/orders/{id}` (minimal API, `MapGroup("/api")`) | — |
| `Services/CheckoutService.cs` | lê o estoque, cobra no Stripe, baixa o estoque e grava o pedido | corrida no estoque (sem transação) e falha parcial (cobra e não grava) |
| `Gateways/StripeGateway.cs` | `HttpClient.PostAsync` para `api.stripe.com` | — |
| `Data/*Repository.cs` | EF Core (`DbSet<T>`, `SaveChangesAsync`) | — |
