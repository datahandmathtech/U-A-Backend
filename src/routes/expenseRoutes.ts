import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get expenses
router.get('/', authenticate, async (req, res) => {
  try {
    const expenses = await prisma.expense.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true } } }
    });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching expenses' });
  }
});

// Create expense
router.post('/', authenticate, async (req, res) => {
  try {
    const { category, amount, description, date } = req.body;
    const paidBy = (req as any).user?.id;
    
    const newExpense = await prisma.expense.create({
      data: {
        category,
        amount: Number(amount),
        description,
        date: date ? new Date(date) : new Date(),
        paidBy
      }
    });
    
    fastCache.invalidate('dashboard_summary');
    res.status(201).json(newExpense);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating expense' });
  }
});

export default router;
