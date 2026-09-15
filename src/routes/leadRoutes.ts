import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get all leads
router.get('/', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('all_leads');
    if (cached) return res.json(cached);

    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      include: { assignedTo: { select: { name: true } } }
    });
    fastCache.set('all_leads', leads, 120);
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching leads' });
  }
});

// Create a new lead
router.post('/', authenticate, async (req, res) => {
  try {
    const { clientName, contact, email, source, architect, designer, status, notes, assignedToId } = req.body;
    
    const newLead = await prisma.lead.create({
      data: {
        clientName,
        contact,
        email,
        source,
        architect,
        designer,
        status: status || 'new',
        notes,
        assignedToId
      }
    });
    
    fastCache.invalidate('all_leads');
    res.status(201).json(newLead);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating lead' });
  }
});

// Update lead status
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const updatedLead = await prisma.lead.update({
      where: { id: id as string },
      data: { status }
    });
    
    fastCache.invalidate('all_leads');
    res.json(updatedLead);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating lead' });
  }
});

export default router;
