const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pendingLogs = await prisma.productionLog.findMany({
    where: { approvalStatus: 'pending' }
  });
  console.log("Pending Logs:");
  pendingLogs.forEach(log => console.log(log.id, log.stage, log.transactionType, log.approvalStatus));

  const allLogs = await prisma.productionLog.findMany();
  const mtLogs = allLogs.filter(l => l.stage && l.stage.includes('Material'));
  console.log("Material Logs count:", mtLogs.length);
  
  await prisma.$disconnect();
}
main();
