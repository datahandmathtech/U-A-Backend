const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Deleting InventoryLog...");
  await prisma.inventoryLog.deleteMany({});
  
  console.log("Deleting Inventory...");
  await prisma.inventory.deleteMany({});
  
  // Also clear DailyStockBalance just in case
  console.log("Deleting DailyStockBalance...");
  await prisma.dailyStockBalance.deleteMany({});

  console.log("All inventory data deleted successfully.");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
