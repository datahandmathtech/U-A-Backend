const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.productionLog.updateMany({
    where: { stage: 'Material Tracking', approvalStatus: 'pending' },
    data: { approvalStatus: 'approved' }
  });
  console.log("Updated:", result.count);
  await prisma.$disconnect();
}
main();
