const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allLogs = await prisma.productionLog.findMany();
  const mtLogs = allLogs.filter(l => l.stage && l.stage.includes('Material Tracking'));
  console.log("Material Logs count:", mtLogs.length);
  mtLogs.forEach(log => console.log(log.id, log.stage, log.transactionType, log.approvalStatus, log.quantityProduced));
  await prisma.$disconnect();
}
main();
