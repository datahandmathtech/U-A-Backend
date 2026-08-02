const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allInLogs = await prisma.productionLog.findMany({
    where: { transactionType: 'IN', approvalStatus: 'approved', parentLogId: { not: null } }
  });
  
  let updatedCount = 0;
  for (const inLog of allInLogs) {
    if (inLog.parentLogId) {
      if (inLog.stage === 'Production Work') {
        try {
          await prisma.machineLog.update({
            where: { id: inLog.parentLogId },
            data: { status: 'completed', approvalStatus: 'approved' }
          });
          updatedCount++;
        } catch (e) {}
      } else {
        try {
          await prisma.productionLog.update({
            where: { id: inLog.parentLogId },
            data: { isReturned: true }
          });
          updatedCount++;
        } catch (e) {}
      }
    }
  }
  console.log("Updated parent logs:", updatedCount);
  await prisma.$disconnect();
}
main();
