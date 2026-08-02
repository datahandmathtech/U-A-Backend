const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const newLog = await prisma.productionLog.create({
      data: {
        stage: 'Material Tracking',
        quantityProduced: 1,
        transactionType: 'IN',
        startPhotos: { machine: 'http' },
        workerId: undefined,
        vendorName: undefined,
        vehicleNumber: undefined,
        challanNumber: undefined,
        parentLogId: undefined,
        approvalStatus: 'pending',
        status: 'completed',
        isReturned: false
      }
    });
    console.log("SUCCESS", newLog.id);
  } catch (err) {
    console.error("ERROR", err);
  } finally {
    await prisma.$disconnect();
  }
}
main();
