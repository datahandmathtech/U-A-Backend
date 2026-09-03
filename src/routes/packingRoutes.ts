import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Get packing items for a project
router.get('/:projectId', authenticate, async (req, res) => {
  try {
    const items = await prisma.packingItem.findMany({
      where: { projectId: String(req.params.projectId) },
      orderBy: { createdAt: 'desc' }
    });
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Save/update packing items for a project (bulk upsert)
router.post('/:projectId', authenticate, async (req, res) => {
  try {
    const projectId = String(req.params.projectId);
    const { items } = req.body;

    await prisma.packingItem.deleteMany({ where: { projectId } });

    const created = [];
    for (const item of items) {
      const newItem = await prisma.packingItem.create({
        data: {
          projectId,
          box: item.box || '',
          code: item.code || '',
          subCategory: item.subCategory || undefined,
          size: item.size || undefined,
          pcs: item.pcs ? Number(item.pcs) : undefined,
        }
      });
      created.push(newItem);
    }

    res.json(created);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a single packing item
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await prisma.packingItem.delete({ where: { id: String(req.params.id) } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
