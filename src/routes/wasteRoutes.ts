import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const prisma = new PrismaClient();
const router = Router();

// Get all waste materials (ProjectMaterials with wasteQuantity > 0)
router.get('/', authenticate, async (req, res) => {
  try {
    const { month, year } = req.query;

    const whereClause: any = {
      wasteQuantity: { gt: 0 }
    };

    if (month && year) {
      const startDate = new Date(Number(year), Number(month) - 1, 1);
      const endDate = new Date(Number(year), Number(month), 1);
      whereClause.addedAt = {
        gte: startDate,
        lt: endDate
      };
    }

    const wasteMaterials = await prisma.projectMaterial.findMany({
      where: whereClause,
      include: {
        project: { select: { name: true, projectId: true } },
        inventory: { select: { itemName: true, type: true, supplier: true } }
      },
      orderBy: { addedAt: 'desc' }
    });

    res.json(wasteMaterials);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching waste materials' });
  }
});

export default router;
