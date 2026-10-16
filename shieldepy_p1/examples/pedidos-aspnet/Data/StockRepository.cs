using Microsoft.EntityFrameworkCore;

namespace Pedidos.Data;

public class StockRepository
{
    private readonly AppDbContext _db;

    public StockRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<int> AvailableAsync(string productId)
    {
        var item = await _db.Stock.FirstOrDefaultAsync(s => s.ProductId == productId);
        return item?.Quantity ?? 0;
    }

    public async Task DecrementAsync(string productId, int amount)
    {
        var item = await _db.Stock.SingleAsync(s => s.ProductId == productId);
        item.Quantity -= amount;
        _db.Stock.Update(item);
        await _db.SaveChangesAsync();
    }
}
