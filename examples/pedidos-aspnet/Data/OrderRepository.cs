using Pedidos.Models;

namespace Pedidos.Data;

public class OrderRepository
{
    private readonly AppDbContext _db;

    public OrderRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<Order> InsertAsync(Order order)
    {
        _db.Orders.Add(order);
        await _db.SaveChangesAsync();
        return order;
    }

    public async Task<Order?> FindByIdAsync(int id)
    {
        return await _db.Orders.FindAsync(id);
    }
}
