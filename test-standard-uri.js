const { PrismaClient } = require('@prisma/client');
const uri = 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?replicaSet=atlas-icn4hi-shard-0&ssl=true&authSource=admin&retryWrites=true&w=majority';
process.env.DATABASE_URL = uri;
const prisma = new PrismaClient({ datasources: { db: { url: uri } } });
async function test() {
  try {
    const start = Date.now();
    const user = await prisma.user.findFirst();
    console.log('SUCCESS in', Date.now() - start, 'ms');
  } catch(e) {
    console.log('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
test();
