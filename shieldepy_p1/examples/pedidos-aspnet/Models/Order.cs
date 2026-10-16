namespace Pedidos.Models;

public class Order
{
    public int Id { get; set; }
    public string ProductId { get; set; } = "";
    public int Quantity { get; set; }
    public string ChargeId { get; set; } = "";
}

public class StockItem
{
    public string ProductId { get; set; } = "";
    public int Quantity { get; set; }
}

public record CheckoutInput(string ProductId, int Quantity, int PriceCents, string CardToken);

public record Charge(string Id, string Status);
