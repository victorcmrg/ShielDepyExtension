using Microsoft.EntityFrameworkCore;
using Pedidos.Models;

namespace Pedidos.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Order> Orders => Set<Order>();
    public DbSet<StockItem> Stock => Set<StockItem>();
}
