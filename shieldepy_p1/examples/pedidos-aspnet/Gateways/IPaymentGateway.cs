using Pedidos.Models;

namespace Pedidos.Gateways;

public interface IPaymentGateway
{
    Task<Charge> ChargeAsync(int amountCents, string token);
}
