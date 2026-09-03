const fs = require('fs');
let c = fs.readFileSync('prisma/schema.prisma', 'utf8');
c = c.replace(/slabs          Slab\[\]\r?\n\}/g, 'slabs          Slab[]\n\n  @@index([status])\n  @@index([createdAt])\n}');
c = c.replace(/updatedAt           DateTime  @updatedAt\r?\n\}/g, 'updatedAt           DateTime  @updatedAt\n\n  @@index([status])\n  @@index([startTime])\n  @@index([createdAt])\n}');
c = c.replace(/parentLogId     String\?   @db\.ObjectId\r?\n\}/g, 'parentLogId     String?   @db.ObjectId\n\n  @@index([approvalStatus])\n  @@index([transactionType])\n  @@index([createdAt])\n}');
fs.writeFileSync('prisma/schema.prisma', c);
console.log("Indexes added");
