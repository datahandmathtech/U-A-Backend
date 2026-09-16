const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  const start = Date.now();
  console.log('Testing login query...');
  const cleanInput = 'admin@unnati.com';
  const capitalizedInput = 'Admin@unnati.com';
  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanInput },
          { staffId: cleanInput },
          { email: cleanInput.toLowerCase() },
          { name: cleanInput },
          { name: cleanInput.toLowerCase() },
          { name: capitalizedInput }
        ]
      }
    });
    console.log('Finished in ' + (Date.now() - start) + 'ms');
  } catch (e) {
    console.log('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
test();
