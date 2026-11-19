import express from 'express';
import { prisma } from '../index';
import { fastCache } from '../utils/fastCache';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// GET all cash transactions and summary
router.get('/', authenticate, async (req: any, res: any) => {
  try {
    const { startDate, endDate, month, year, category, type } = req.query;

    const where: any = {};

    if (type && (type === 'IN' || type === 'OUT')) {
      where.type = type;
    }
    if (category) {
      where.category = category;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(String(startDate));
      if (endDate) {
        const end = new Date(String(endDate));
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    } else if (month !== undefined && month !== '' && year) {
      const m = parseInt(String(month), 10);
      const y = parseInt(String(year), 10);
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      where.date = { gte: start, lte: end };
    }

    // 1. Calculate overall totals (All-time or up to filtered date)
    const allTransactions = await prisma.cashTransaction.findMany({
      orderBy: { date: 'asc' },
      include: {
        createdBy: {
          select: { id: true, name: true }
        }
      }
    });

    let overallIn = 0;
    let overallOut = 0;
    let runningBal = 0;

    const enrichedAll = allTransactions.map((tx) => {
      if (tx.type === 'IN') {
        overallIn += tx.amount;
        runningBal += tx.amount;
      } else {
        overallOut += tx.amount;
        runningBal -= tx.amount;
      }
      return {
        ...tx,
        runningBalance: Math.round(runningBal * 100) / 100
      };
    });

    const currentBalance = Math.round((overallIn - overallOut) * 100) / 100;

    // Filter for current view
    let filteredTransactions = enrichedAll;
    if (where.date || where.type || where.category) {
      filteredTransactions = enrichedAll.filter((tx) => {
        if (where.type && tx.type !== where.type) return false;
        if (where.category && tx.category !== where.category) return false;
        if (where.date?.gte && new Date(tx.date) < where.date.gte) return false;
        if (where.date?.lte && new Date(tx.date) > where.date.lte) return false;
        return true;
      });
    }

    // Sort descending for display (latest first)
    const displayTransactions = [...filteredTransactions].reverse();

    const periodIn = filteredTransactions.filter(t => t.type === 'IN').reduce((acc, t) => acc + t.amount, 0);
    const periodOut = filteredTransactions.filter(t => t.type === 'OUT').reduce((acc, t) => acc + t.amount, 0);

    res.json({
      summary: {
        totalIn: Math.round(overallIn * 100) / 100,
        totalOut: Math.round(overallOut * 100) / 100,
        currentBalance,
        periodIn: Math.round(periodIn * 100) / 100,
        periodOut: Math.round(periodOut * 100) / 100,
        transactionCount: filteredTransactions.length
      },
      transactions: displayTransactions
    });
  } catch (error: any) {
    console.error('Error fetching cash book:', error);
    res.status(500).json({ message: 'Error fetching cash book', error: error.message });
  }
});

// POST a new cash transaction (IN or OUT)
router.post('/', authenticate, async (req: any, res: any) => {
  try {
    const {
      type,
      amount,
      category,
      description,
      paidToReceivedFrom,
      paymentMode,
      voucherNumber,
      receiptPhoto,
      date,
      sourceModule,
      sourceId
    } = req.body;

    if (!type || !amount || !category) {
      return res.status(400).json({ message: 'Type, amount, and category are required' });
    }

    const numAmount = parseFloat(String(amount));
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ message: 'Valid positive amount is required' });
    }

    const newTx = await prisma.cashTransaction.create({
      data: {
        type: type === 'IN' ? 'IN' : 'OUT',
        amount: numAmount,
        category: category.trim(),
        description: description?.trim() || null,
        paidToReceivedFrom: paidToReceivedFrom?.trim() || null,
        paymentMode: paymentMode || 'Cash',
        voucherNumber: voucherNumber?.trim() || null,
        receiptPhoto: receiptPhoto || null,
        date: date ? new Date(date) : new Date(),
        sourceModule: sourceModule || 'manual',
        sourceId: sourceId || null,
        createdById: req.user?.id || undefined
      }
    });

    fastCache.clearAll();
    res.status(201).json(newTx);
  } catch (error: any) {
    console.error('Error creating cash transaction:', error);
    res.status(500).json({ message: 'Error creating cash transaction', error: error.message });
  }
});

// PUT update cash transaction
router.put('/:id', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const {
      type,
      amount,
      category,
      description,
      paidToReceivedFrom,
      paymentMode,
      voucherNumber,
      receiptPhoto,
      date
    } = req.body;

    const data: any = {};
    if (type) data.type = type === 'IN' ? 'IN' : 'OUT';
    if (amount !== undefined) data.amount = parseFloat(String(amount));
    if (category !== undefined) data.category = category.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (paidToReceivedFrom !== undefined) data.paidToReceivedFrom = paidToReceivedFrom?.trim() || null;
    if (paymentMode !== undefined) data.paymentMode = paymentMode;
    if (voucherNumber !== undefined) data.voucherNumber = voucherNumber?.trim() || null;
    if (receiptPhoto !== undefined) data.receiptPhoto = receiptPhoto || null;
    if (date !== undefined) data.date = new Date(date);

    const updated = await prisma.cashTransaction.update({
      where: { id: String(id) },
      data
    });

    fastCache.clearAll();
    res.json(updated);
  } catch (error: any) {
    console.error('Error updating cash transaction:', error);
    res.status(500).json({ message: 'Error updating cash transaction', error: error.message });
  }
});

// DELETE cash transaction
router.delete('/:id', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const existing = await prisma.cashTransaction.findUnique({
      where: { id: String(id) }
    });

    if (!existing) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // If linked to maintenance, unlink
    if (existing.sourceId && existing.sourceModule === 'maintenance') {
      await prisma.machineMaintenance.updateMany({
        where: { id: existing.sourceId },
        data: { cashTransactionId: null }
      }).catch(() => {});
    }

    await prisma.cashTransaction.delete({
      where: { id: String(id) }
    });

    fastCache.clearAll();
    res.json({ success: true, message: 'Cash transaction deleted' });
  } catch (error: any) {
    console.error('Error deleting cash transaction:', error);
    res.status(500).json({ message: 'Error deleting cash transaction', error: error.message });
  }
});

export default router;
