import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const prisma = new PrismaClient();
const router = Router();

// Get all waste materials
router.get('/', authenticate, async (req, res) => {
  try {
    const { month, year } = req.query;

    const pmWhereClause: any = {
      wasteQuantity: { gt: 0 }
    };
    const logWhereClause: any = {
      remarks: 'Waste'
    };

    if (month && year) {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 1);
      pmWhereClause.addedAt = { gte: startDate, lt: endDate };
      logWhereClause.createdAt = { gte: startDate, lt: endDate };
    }

    // 1. Fetch from ProjectMaterial
    const wasteMaterials = await prisma.projectMaterial.findMany({
      where: pmWhereClause,
      include: {
        project: { select: { name: true, projectId: true } },
        inventory: { select: { itemName: true, type: true, supplier: true } }
      },
      orderBy: { addedAt: 'desc' }
    });

    // 2. Fetch from InventoryLog
    const wasteLogs = await prisma.inventoryLog.findMany({
      where: logWhereClause,
      include: {
        inventory: { select: { itemName: true, type: true, supplier: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 3. Map logs to look like ProjectMaterial waste
    const formattedLogs = wasteLogs.map(log => ({
      id: log.id,
      addedAt: log.createdAt,
      project: null,
      inventory: log.inventory,
      quantity: 0,
      usedQuantity: 0,
      wasteQuantity: log.quantity
    }));

    // Combine and sort by date
    const combined = [...wasteMaterials, ...formattedLogs].sort((a, b) => 
      new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );

    res.json(combined);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching waste materials' });
  }
});

export default router;