using System.Net.Http.Json;
using Pedidos.Models;

namespace Pedidos.Gateways;

/// Chamada ao Stripe sem retry; o timeout fica no padrão do HttpClient (100 s).
public class StripeGateway : IPaymentGateway
{
    private readonly HttpClient _http;

    public StripeGateway(HttpClient http)
    {
        _http = http;
    }

    public async Task<Charge> ChargeAsync(int amountCents, string token)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["amount"] = amountCents.ToString(),
            ["currency"] = "brl",
            ["source"] = token,
        });
        var response = await _http.PostAsync("https://api.stripe.com/v1/charges", form);
        var charge = await response.Content.ReadFromJsonAsync<Charge>();
        return charge!;
    }
}
