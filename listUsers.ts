import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.user.findMany().then(users => console.log(users)).catch(e => console.error(e)).finally(() => prisma.$disconnect());
