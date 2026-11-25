import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { invalidateProjectCaches } from '../utils/projectSync';

const router = Router();

// Get Project Closures
router.get('/', authenticate, async (req, res) => {
  try {
    const closures = await prisma.projectClosure.findMany({
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } } }
    });
    res.json(closures);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching closures' });
  }
});

// Create Closure
router.post('/', authenticate, async (req, res) => {
  try {
    const { projectId, deliveryDate, clientFeedback, rating } = req.body;
    
    const newClosure = await prisma.projectClosure.create({
      data: {
        projectId,
        deliveryDate: new Date(deliveryDate),
        clientFeedback,
        rating: Number(rating),
        status: 'closed'
      }
    });

    // Also update project status to completed
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'completed' }
    });

    invalidateProjectCaches(projectId);
    res.status(201).json(newClosure);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating project closure' });
  }
});

export default router;
