import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Get all vendors
router.get('/', async (req, res) => {
  try {
    const { month, fy } = req.query;
    const vendors = await prisma.vendor.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const today = new Date();
    let startOfFY, endOfFY;

    if (fy && typeof fy === 'string' && fy !== 'undefined') {
      const parts = String(fy).split(' ');
      const yearPart = parts[1] || `${new Date().getFullYear()}`;
      const yearStr = yearPart.split('-')[0] || `${new Date().getFullYear()}`;
      const fyStartYear = parseInt(yearStr, 10);
      startOfFY = new Date(`${fyStartYear}-04-01T00:00:00.000Z`);
      endOfFY = new Date(`${fyStartYear + 1}-03-31T23:59:59.999Z`);
    } else {
      const currentYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
      startOfFY = new Date(`${currentYear}-04-01T00:00:00.000Z`);
      endOfFY = new Date(`${currentYear + 1}-03-31T23:59:59.999Z`);
    }

    const allLogs = await prisma.productionLog.findMany({
      where: {
        vendorId: { in: vendors.map(v => v.id) },
        createdAt: { gte: startOfFY, lte: endOfFY }
      }
    });

    const vendorStats = vendors.map((vendor) => {
      const logs = allLogs.filter(log => log.vendorId === vendor.id);

      let filteredLogs = logs;
      if (month && month !== 'All' && month !== 'undefined') {
        filteredLogs = logs.filter((log) => {
          const d = new Date(log.createdAt);
          const monthStr = `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`;
          return monthStr === month;
        });
      }

      const totalOut = filteredLogs.reduce((acc, log) => acc + (log.transactionType === 'OUT' ? (log.quantityProduced || 0) : 0), 0);
      const totalIn = filteredLogs.reduce((acc, log) => acc + (log.transactionType === 'IN' ? (log.quantityProduced || 0) : 0), 0);
      
      return {
        ...vendor,
        totalOut,
        totalIn,
        balance: totalOut - totalIn
      };
    });

    res.json(vendorStats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// Get single vendor ledger
router.get('/:id/ledger', async (req, res) => {
  try {
    const { id } = req.params;
    const today = new Date();
    const currentYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    const startOfFY = new Date(`${currentYear}-04-01T00:00:00.000Z`);
    const endOfFY = new Date(`${currentYear + 1}-03-31T23:59:59.999Z`);

    const logs = await prisma.productionLog.findMany({
      where: {
        vendorId: id,
        createdAt: { gte: startOfFY, lte: endOfFY }
      },
      orderBy: { createdAt: 'asc' }, // Ascending for running balance
      include: {
        project: { select: { name: true } }
      }
    });

    let runningBalance = 0;
    const ledgerEntries = logs.map(log => {
      const isOut = log.transactionType === 'OUT';
      const piecesOut = isOut ? (log.quantityProduced || 0) : 0;
      const piecesIn = !isOut ? (log.quantityProduced || 0) : 0;
      
      runningBalance = runningBalance + piecesOut - piecesIn; // +Out -In

      return {
        id: log.id,
        date: log.createdAt,
        narration: `${isOut ? 'OUT' : 'IN'} - ${log.stage} - ${log.productName || 'Product'}`,
        stage: log.stage,
        vehicleNumber: log.vehicleNumber || '-',
        piecesOut,
        piecesIn,
        balance: runningBalance,
        transactionType: log.transactionType,
        rawLog: log
      };
    });

    res.json(ledgerEntries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch vendor ledger' });
  }
});

// Create vendor
router.post('/', async (req, res) => {
  try {
    const { name, contact, address, services } = req.body;
    const vendor = await prisma.vendor.create({
      data: { name, contact, address, services }
    });
    res.status(201).json(vendor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// Update vendor
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact, address, services, status } = req.body;
    const vendor = await prisma.vendor.update({
      where: { id },
      data: { name, contact, address, services, status }
    });
    res.json(vendor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// Delete vendor
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.vendor.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

export default router;
