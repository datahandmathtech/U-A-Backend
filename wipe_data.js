const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing transactional data...');
  await prisma.pieceLog.deleteMany({});
  await prisma.piece.deleteMany({});
  await prisma.slab.deleteMany({});
  await prisma.productionLog.deleteMany({});
  await prisma.machineLog.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.quotation.deleteMany({});
  await prisma.projectMaterial.deleteMany({});
  await prisma.projectClosure.deleteMany({});
  await prisma.dispatch.deleteMany({});
  await prisma.crate.deleteMany({});
  await prisma.design.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.shopDrawing.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.lead.deleteMany({});
  console.log('Data cleared!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
