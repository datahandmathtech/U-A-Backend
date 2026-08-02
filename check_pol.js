const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allLogs = await prisma.productionLog.findMany();
  const polLogs = allLogs.filter(l => l.stage === 'Polishing');
  console.log("Polishing Logs count:", polLogs.length);
  polLogs.forEach(log => console.log(log.id, log.transactionType, log.approvalStatus, log.quantityProduced, log.isReturned));
  await prisma.$disconnect();
}
main();
