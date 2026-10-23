using Microsoft.AspNetCore.Mvc;
using Pedidos.Models;
using Pedidos.Services;

namespace Pedidos.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CheckoutController : ControllerBase
{
    private readonly CheckoutService _service;

    public CheckoutController(CheckoutService service)
    {
        _service = service;
    }

    [HttpPost]
    public async Task<IActionResult> Create(CheckoutInput input)
    {
        try
        {
            var order = await _service.CheckoutAsync(input);
            return Created($"/api/orders/{order.Id}", order);
        }
        catch (OutOfStockException)
        {
            return Conflict(new { error = "sem estoque" });
        }
    }
}
