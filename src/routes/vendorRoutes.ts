import express from 'express';
import { prisma } from '../index';
import { fastCache } from '../utils/fastCache';

const router = express.Router();

// Get all vendors
router.get('/', async (req, res) => {
  try {
    const { month, fy } = req.query;
    const cacheKey = `vendors_stats_${fy || 'default'}_${month || 'all'}`;
    const cached = fastCache.get(cacheKey);
    if (cached) return res.json(cached);

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

    let vendors: any[] = [];
    let allLogs: any[] = [];

    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const rawVendors = await db.collection('Vendor').find({ status: 'active' }).sort({ createdAt: -1 }).toArray();
        const vendorIds = rawVendors.map((v: any) => v._id.toString());
        const rawLogs = await db.collection('ProductionLog').find({
          vendorId: { $in: vendorIds },
          createdAt: { $gte: startOfFY, $lte: endOfFY }
        }).toArray();

        vendors = rawVendors.map((v: any) => ({ ...v, id: v._id.toString() }));
        allLogs = rawLogs.map((l: any) => ({ ...l, id: l._id.toString(), createdAt: new Date(l.createdAt) }));
      } catch (mErr) {
        console.warn('Mongoose vendors fetch failed:', mErr);
      }
    }

    if (vendors.length === 0) {
      vendors = await prisma.vendor.findMany({
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' }
      });

      allLogs = await prisma.productionLog.findMany({
        where: {
          vendorId: { in: vendors.map(v => v.id) },
          createdAt: { gte: startOfFY, lte: endOfFY }
        }
      });
    }

    const vendorStats = vendors.map((vendor) => {
      const logs = allLogs.filter(log => log.vendorId === vendor.id);

      let filteredLogs = logs;
      let pastLogs: any[] = [];
      let openingBalance = 0;

      if (month && month !== 'All' && month !== 'undefined') {
        const monthFilterIndex = logs.findIndex(l => {
           const d = new Date(l.createdAt);
           const monthStr = `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`;
           return monthStr === month;
        });
        
        filteredLogs = logs.filter((log) => {
          const d = new Date(log.createdAt);
          const monthStr = `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`;
          return monthStr === month;
        });

        // Determine chronological start of the selected month to find past logs
        const selectedMonthParts = String(month).split(' ');
        const monthMap: Record<string, number> = { 'January':0, 'February':1, 'March':2, 'April':3, 'May':4, 'June':5, 'July':6, 'August':7, 'September':8, 'October':9, 'November':10, 'December':11 };
        const monthName = selectedMonthParts[0] || '';
        const monthNum = monthMap[monthName];
        const yearNum = parseInt(selectedMonthParts[1] || '0');
        if (monthNum !== undefined && yearNum) {
            const startOfSelectedMonth = new Date(yearNum, monthNum, 1);
            pastLogs = logs.filter(log => new Date(log.createdAt) < startOfSelectedMonth);
            
            const pastOut = pastLogs.reduce((acc, log) => acc + (log.transactionType === 'OUT' ? (log.quantityProduced || 0) : 0), 0);
            const pastIn = pastLogs.reduce((acc, log) => acc + (log.transactionType === 'IN' ? (log.quantityProduced || 0) : 0), 0);
            openingBalance = pastOut - pastIn;
        }
      }

      const totalOut = filteredLogs.reduce((acc, log) => acc + (log.transactionType === 'OUT' ? (log.quantityProduced || 0) : 0), 0);
      const totalIn = filteredLogs.reduce((acc, log) => acc + (log.transactionType === 'IN' ? (log.quantityProduced || 0) : 0), 0);
      
      return {
        ...vendor,
        openingBalance,
        totalOut,
        totalIn,
        balance: openingBalance + totalOut - totalIn
      };
    });

    fastCache.set(cacheKey, vendorStats, 120);
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
    const cacheKey = `vendor_ledger_${id}`;
    const cached = fastCache.get(cacheKey);
    if (cached) return res.json(cached);

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

    fastCache.set(cacheKey, ledgerEntries, 120);
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
    fastCache.invalidate('vendors_stats');
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
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate(`vendor_ledger_${id}`);
    res.json(vendor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// Delete (soft delete) vendor
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.vendor.update({ 
      where: { id },
      data: { status: 'inactive' }
    });
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate(`vendor_ledger_${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

export default router;
