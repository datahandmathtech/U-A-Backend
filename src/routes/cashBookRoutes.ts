import express from 'express';
import mongoose from 'mongoose';
import { prisma } from '../index';
import { fastCache } from '../utils/fastCache';
import { authenticate } from '../middleware/auth';

const router = express.Router();

const getDb = () => mongoose.connection?.db;

// GET all cash transactions and summary
router.get('/', authenticate, async (req: any, res: any) => {
  try {
    const { startDate, endDate, month, year, category, type } = req.query;

    const cacheKey = `cash_book_${startDate || ''}_${endDate || ''}_${month !== undefined ? month : ''}_${year || ''}_${category || ''}_${type || ''}`;
    const cachedData = fastCache.get(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

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

    let allTransactions: any[] = [];
    const db = getDb();

    if (db) {
      try {
        const rawTxs = await db.collection('CashTransaction').find({}).sort({ date: 1 }).toArray();

        // Extract unique user IDs for createdBy lookup
        const userIds = Array.from(new Set(rawTxs.map((t: any) => t.createdById).filter(Boolean)));
        const userObjIds = userIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id));

        const rawUsers = userIds.length > 0
          ? await db.collection('User').find(
              { $or: [{ _id: { $in: userObjIds } }, { id: { $in: userIds } }] },
              { projection: { name: 1 } }
            ).toArray()
          : [];

        const userMap = new Map<string, { id: string; name: string }>();
        rawUsers.forEach((u: any) => {
          userMap.set(u._id.toString(), { id: u._id.toString(), name: u.name });
        });

        allTransactions = rawTxs.map((tx: any) => {
          const u = tx.createdById ? userMap.get(tx.createdById.toString()) || null : null;
          return {
            ...tx,
            id: tx._id.toString(),
            amount: Number(tx.amount) || 0,
            createdBy: u
          };
        });
      } catch (mErr) {
        console.warn('Mongoose cash transaction query error, falling back to Prisma:', mErr);
      }
    }

    // Prisma Fallback with 3-second safeguard timeout if db collection didn't succeed
    if (allTransactions.length === 0 && !db) {
      try {
        const prismaPromise = prisma.cashTransaction.findMany({
          orderBy: { date: 'asc' },
          include: {
            createdBy: {
              select: { id: true, name: true }
            }
          }
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Prisma cash query timeout')), 3000)
        );
        allTransactions = (await Promise.race([prismaPromise, timeoutPromise])) as any[];
      } catch (pErr) {
        console.warn('Prisma cash transaction fallback error:', pErr);
        allTransactions = [];
      }
    }

    let overallIn = 0;
    let overallOut = 0;
    let runningBal = 0;

    const enrichedAll = allTransactions.map((tx: any) => {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'IN') {
        overallIn += amt;
        runningBal += amt;
      } else {
        overallOut += amt;
        runningBal -= amt;
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
      filteredTransactions = enrichedAll.filter((tx: any) => {
        if (where.type && tx.type !== where.type) return false;
        if (where.category && tx.category !== where.category) return false;
        if (where.date?.gte && new Date(tx.date) < where.date.gte) return false;
        if (where.date?.lte && new Date(tx.date) > where.date.lte) return false;
        return true;
      });
    }

    // Sort descending for display (latest first)
    const displayTransactions = [...filteredTransactions].reverse();

    const periodIn = filteredTransactions.filter((t: any) => t.type === 'IN').reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);
    const periodOut = filteredTransactions.filter((t: any) => t.type === 'OUT').reduce((acc: number, t: any) => acc + (Number(t.amount) || 0), 0);

    const result = {
      summary: {
        totalIn: Math.round(overallIn * 100) / 100,
        totalOut: Math.round(overallOut * 100) / 100,
        currentBalance,
        periodIn: Math.round(periodIn * 100) / 100,
        periodOut: Math.round(periodOut * 100) / 100,
        transactionCount: filteredTransactions.length
      },
      transactions: displayTransactions
    };

    fastCache.set(cacheKey, result, 15);
    return res.json(result);
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

    const db = getDb();
    let newTx: any = null;

    if (db) {
      try {
        const txDoc: any = {
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
          createdById: req.user?.id ? (mongoose.Types.ObjectId.isValid(req.user.id) ? new mongoose.Types.ObjectId(req.user.id) : req.user.id) : null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        const ins = await db.collection('CashTransaction').insertOne(txDoc);
        newTx = { ...txDoc, id: ins.insertedId.toString() };
      } catch (mErr) {
        console.warn('Mongoose insert failed, falling back to Prisma:', mErr);
      }
    }

    if (!newTx) {
      newTx = await prisma.cashTransaction.create({
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
    }

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

    const data: any = { updatedAt: new Date() };
    if (type) data.type = type === 'IN' ? 'IN' : 'OUT';
    if (amount !== undefined) data.amount = parseFloat(String(amount));
    if (category !== undefined) data.category = category.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (paidToReceivedFrom !== undefined) data.paidToReceivedFrom = paidToReceivedFrom?.trim() || null;
    if (paymentMode !== undefined) data.paymentMode = paymentMode;
    if (voucherNumber !== undefined) data.voucherNumber = voucherNumber?.trim() || null;
    if (receiptPhoto !== undefined) data.receiptPhoto = receiptPhoto || null;
    if (date !== undefined) data.date = new Date(date);

    const db = getDb();
    let updated: any = null;

    if (db) {
      try {
        const query = mongoose.Types.ObjectId.isValid(id)
          ? { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { id: String(id) }] }
          : { id: String(id) };
        await db.collection('CashTransaction').updateOne(query, { $set: data });
        updated = await db.collection('CashTransaction').findOne(query);
        if (updated) {
          updated.id = updated._id.toString();
        }
      } catch (mErr) {
        console.warn('Mongoose update failed, falling back to Prisma:', mErr);
      }
    }

    if (!updated) {
      updated = await prisma.cashTransaction.update({
        where: { id: String(id) },
        data
      });
    }

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
    const db = getDb();

    let existing: any = null;
    if (db) {
      try {
        const query = mongoose.Types.ObjectId.isValid(id)
          ? { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { id: String(id) }] }
          : { id: String(id) };
        existing = await db.collection('CashTransaction').findOne(query);
      } catch (mErr) {
        console.warn('Mongoose findOne error, falling back to Prisma:', mErr);
      }
    }

    if (!existing) {
      existing = await prisma.cashTransaction.findUnique({
        where: { id: String(id) }
      });
    }

    if (!existing) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // If linked to maintenance, unlink
    if (existing.sourceId && existing.sourceModule === 'maintenance') {
      if (db) {
        const mQuery = mongoose.Types.ObjectId.isValid(existing.sourceId)
          ? { $or: [{ _id: new mongoose.Types.ObjectId(existing.sourceId) }, { id: existing.sourceId }] }
          : { id: existing.sourceId };
        await db.collection('MachineMaintenance').updateMany(mQuery, { $set: { cashTransactionId: null } }).catch(() => {});
      } else {
        await prisma.machineMaintenance.updateMany({
          where: { id: existing.sourceId },
          data: { cashTransactionId: null }
        }).catch(() => {});
      }
    }

    if (db) {
      const query = mongoose.Types.ObjectId.isValid(id)
        ? { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { id: String(id) }] }
        : { id: String(id) };
      await db.collection('CashTransaction').deleteOne(query);
    } else {
      await prisma.cashTransaction.delete({
        where: { id: String(id) }
      });
    }

    fastCache.clearAll();
    res.json({ success: true, message: 'Cash transaction deleted' });
  } catch (error: any) {
    console.error('Error deleting cash transaction:', error);
    res.status(500).json({ message: 'Error deleting cash transaction', error: error.message });
  }
});

export default router;
