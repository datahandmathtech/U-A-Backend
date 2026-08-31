const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const pms = await prisma.projectMaterial.findMany({ include: { inventory: true }});
  console.log(JSON.stringify(pms.slice(-5), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
