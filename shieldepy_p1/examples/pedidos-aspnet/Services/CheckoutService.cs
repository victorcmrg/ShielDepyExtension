using Pedidos.Data;
using Pedidos.Gateways;
using Pedidos.Models;

namespace Pedidos.Services;

public class OutOfStockException : Exception
{
    public OutOfStockException(string productId) : base(productId) { }
}

public class CheckoutService
{
    private readonly StockRepository _stock;
    private readonly OrderRepository _orders;
    private readonly IPaymentGateway _payments;

    public CheckoutService(StockRepository stock, OrderRepository orders, IPaymentGateway payments)
    {
        _stock = stock;
        _orders = orders;
        _payments = payments;
    }

    /// RACE CONDITION proposital: lê o estoque, espera o Stripe e só depois baixa — sem transação.
    /// Se o banco cair depois da cobrança, o cliente paga e o pedido não é gravado.
    public async Task<Order> CheckoutAsync(CheckoutInput input)
    {
        var available = await _stock.AvailableAsync(input.ProductId);
        if (available < input.Quantity) throw new OutOfStockException(input.ProductId);

        var charge = await _payments.ChargeAsync(input.PriceCents * input.Quantity, input.CardToken);
        await _stock.DecrementAsync(input.ProductId, input.Quantity);
        return await _orders.InsertAsync(new Order { ProductId = input.ProductId, Quantity = input.Quantity, ChargeId = charge.Id });
    }

    public Task<Order?> FindAsync(int id) => _orders.FindByIdAsync(id);
}
