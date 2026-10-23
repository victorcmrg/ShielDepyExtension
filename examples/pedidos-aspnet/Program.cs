using Microsoft.EntityFrameworkCore;
using Pedidos.Data;
using Pedidos.Gateways;
using Pedidos.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddHttpClient<IPaymentGateway, StripeGateway>();
builder.Services.AddScoped<StockRepository>();
builder.Services.AddScoped<OrderRepository>();
builder.Services.AddScoped<CheckoutService>();
builder.Services.AddControllers();

var app = builder.Build();
app.MapControllers();

var api = app.MapGroup("/api");
api.MapGet("/orders/{id}", async (int id, CheckoutService service) =>
{
    var order = await service.FindAsync(id);
    return order is null ? Results.NotFound() : Results.Ok(order);
});

app.Run();
