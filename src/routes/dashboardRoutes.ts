import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';
import { computeDashboardDateRanges, isWorkOrder100PercentDone } from '../utils/dashboardChatHelpers';

const router = Router();

router.get('/summary', authenticate, async (req, res) => {
  try {
    const { fy, month } = req.query;
    const cacheKey = `dashboard_summary_${fy || 'all'}_${month || 'all'}`;
    const cached = fastCache.get(cacheKey);
    if (cached) return res.json(cached);

    let prismaFyFilter: any = {};
    let mongoFyFilter: any = {};
    let prismaMonthExpenseFilter: any = {};
    let mongoMonthExpenseFilter: any = {};
    let prismaMonthMaintFilter: any = {};
    let mongoMonthMaintFilter: any = {};

    const { fyRangeStart, fyRangeEnd, monthRangeStart, monthRangeEnd } = computeDashboardDateRanges(
      typeof fy === 'string' ? fy : null,
      typeof month === 'string' ? month : null
    );

    if (fyRangeStart && fyRangeEnd && monthRangeStart && monthRangeEnd) {
      // Top 4 Cards: Full Financial Year window
      prismaFyFilter = { createdAt: { gte: fyRangeStart, lte: fyRangeEnd } };
      mongoFyFilter = { createdAt: { $gte: fyRangeStart, $lte: fyRangeEnd } };

      // Bottom 4 Cards: Selected Month window inside the Financial Year
      prismaMonthExpenseFilter = { date: { gte: monthRangeStart, lte: monthRangeEnd } };
      mongoMonthExpenseFilter = {
        $or: [
          { date: { $gte: monthRangeStart, $lte: monthRangeEnd } },
          { $and: [{ date: { $exists: false } }, { createdAt: { $gte: monthRangeStart, $lte: monthRangeEnd } }] }
        ]
      };

      prismaMonthMaintFilter = { serviceDate: { gte: monthRangeStart, lte: monthRangeEnd } };
      mongoMonthMaintFilter = {
        $or: [
          { serviceDate: { $gte: monthRangeStart, $lte: monthRangeEnd } },
          { $and: [{ serviceDate: { $exists: false } }, { createdAt: { $gte: monthRangeStart, $lte: monthRangeEnd } }] }
        ]
      };
    }

    let projects: any[] = [];
    let invoices: any[] = [];
    let laborContracts: any[] = [];
    let expenses: any[] = [];
    let maintenances: any[] = [];
    let electricity: any[] = [];
    let rawClosures: any[] = [];
    let rawSlabs: any[] = [];
    let rawPieces: any[] = [];
    let rawPieceLogs: any[] = [];

    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    let dbSuccess = false;
    if (db) {
      try {
        [
          projects,
          invoices,
          laborContracts,
          expenses,
          maintenances,
          electricity,
          rawClosures,
          rawSlabs,
          rawPieces,
          rawPieceLogs
        ] = await Promise.all([
          db.collection('Project').find(mongoFyFilter, { projection: { status: 1, progressPercentage: 1 } }).toArray(),
          db.collection('Invoice').find(mongoFyFilter, { projection: { totalAmount: 1, advancePaid: 1, balanceAmount: 1 } }).toArray(),
          db.collection('LaborContract').find(mongoFyFilter, { projection: { totalAmount: 1 } }).toArray(),
          db.collection('Expense').find(mongoMonthExpenseFilter, { projection: { amount: 1 } }).toArray(),
          db.collection('MachineMaintenance').find(mongoMonthMaintFilter, { projection: { amount: 1 } }).toArray(),
          db.collection('ElectricityLog').find({}, { projection: { month: 1, totalBill: 1 } }).toArray(),
          db.collection('ProjectClosure').find({}, { projection: { projectId: 1, status: 1 } }).toArray(),
          db.collection('Slab').find({}, { projection: { projectId: 1, status: 1, requiredStages: 1 } }).toArray(),
          db.collection('Piece').find({}, { projection: { slabId: 1, stage: 1, status: 1 } }).toArray(),
          db.collection('PieceLog').find({}, { projection: { pieceId: 1, stage: 1, status: 1 } }).toArray()
        ]);
        dbSuccess = true;
      } catch (mErr) {
        console.warn('Mongoose dashboard query failed, falling back to Prisma:', mErr);
      }
    }

    if (!dbSuccess) {
      [projects, invoices, laborContracts, expenses, maintenances, electricity] = await Promise.all([
        prisma.project.findMany({
          where: prismaFyFilter,
          select: {
            id: true,
            status: true,
            progressPercentage: true,
            projectClosure: { select: { id: true, status: true } },
            slabs: {
              select: {
                id: true,
                status: true,
                requiredStages: true,
                pieces: {
                  select: {
                    id: true,
                    stage: true,
                    status: true,
                    logs: { select: { stage: true, status: true } }
                  }
                }
              }
            }
          }
        }),
        prisma.invoice.findMany({ where: prismaFyFilter, select: { totalAmount: true, advancePaid: true, balanceAmount: true } }),
        prisma.laborContract.findMany({ where: prismaFyFilter, select: { totalAmount: true } }),
        prisma.expense.findMany({ where: prismaMonthExpenseFilter, select: { amount: true } }),
        prisma.machineMaintenance.findMany({ where: prismaMonthMaintFilter, select: { amount: true } }),
        prisma.electricityLog.findMany({ select: { month: true, totalBill: true } })
      ]);
    }

    const closedIds = new Set<string>();
    const slabsByProject = new Map<string, any[]>();
    const piecesBySlab = new Map<string, any[]>();
    const logsByPiece = new Map<string, any[]>();

    if (dbSuccess) {
      for (const c of rawClosures) {
        if (c.projectId && (!c.status || c.status === 'closed')) {
          closedIds.add(c.projectId.toString());
        }
      }
      for (const s of rawSlabs) {
        const pId = s.projectId ? s.projectId.toString() : '';
        if (!pId) continue;
        if (!slabsByProject.has(pId)) slabsByProject.set(pId, []);
        slabsByProject.get(pId)!.push(s);
      }
      for (const pc of rawPieces) {
        const sId = pc.slabId ? pc.slabId.toString() : '';
        if (!sId) continue;
        if (!piecesBySlab.has(sId)) piecesBySlab.set(sId, []);
        piecesBySlab.get(sId)!.push(pc);
      }
      for (const lg of rawPieceLogs) {
        const pcId = lg.pieceId ? lg.pieceId.toString() : '';
        if (!pcId) continue;
        if (!logsByPiece.has(pcId)) logsByPiece.set(pcId, []);
        logsByPiece.get(pcId)!.push(lg);
      }
    }

    let totalLeads = 0;
    let activeProjects = 0;
    let pendingQuotations = 0;
    let readyForDispatch = 0;
    let completedProjects = 0;

    for (const p of projects) {
      const pId = p._id ? p._id.toString() : String(p.id || '');
      if (!dbSuccess && p.projectClosure && (!p.projectClosure.status || p.projectClosure.status === 'closed')) {
        closedIds.add(pId);
      }

      if (['pending', 'enquiry', 'design_sharing', 'quotation', 'advance_payment'].includes(p.status)) {
        totalLeads++;
      }
      if (p.status === 'quotation') {
        pendingQuotations++;
      }

      if (['shop_drawing', 'material_planning', 'production', 'work_order', 'completed'].includes(p.status)) {
        const projSlabs = dbSuccess ? (slabsByProject.get(pId) || []) : (p.slabs || []);
        const isDone = isWorkOrder100PercentDone(p, closedIds, projSlabs, piecesBySlab, logsByPiece);
        if (isDone) {
          readyForDispatch++;
          completedProjects++;
        } else {
          activeProjects++;
        }
      }
    }

    const totalRevenue = invoices.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
    const advancePaidTotal = invoices.reduce((acc, curr) => acc + (curr.advancePaid || 0), 0);
    const pendingInvoicesTotal = invoices.reduce((acc, curr) => acc + (curr.balanceAmount || 0), 0);
    const laborCost = laborContracts.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
    const generalExpenses = expenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const maintenanceExpenses = maintenances.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const factoryExpenses = Math.round((generalExpenses + maintenanceExpenses) * 100) / 100;

    // Bottom 4 (1/4): Petty Cash in hand from CashTransaction for the selected Month
    let pettyCashInHand = 0;
    try {
      let cashTransactions: any[] = [];
      if (db) {
        cashTransactions = await db.collection('CashTransaction').find(mongoMonthExpenseFilter).toArray();
      } else {
        cashTransactions = await prisma.cashTransaction.findMany({ where: prismaMonthExpenseFilter });
      }
      if (cashTransactions && cashTransactions.length > 0) {
        const inSum = cashTransactions.filter((c: any) => c.type === 'IN').reduce((acc: number, c: any) => acc + (Number(c.amount) || 0), 0);
        const outSum = cashTransactions.filter((c: any) => c.type === 'OUT').reduce((acc: number, c: any) => acc + (Number(c.amount) || 0), 0);
        pettyCashInHand = inSum - outSum;
      }
    } catch (e) {
      console.warn('Failed to query CashTransaction:', e);
    }

    // Bottom 4 (2/4 & 4/4): Vendor In/Out Material Ledger totals for the selected Month
    let matStart = monthRangeStart;
    let matEnd = monthRangeEnd;
    if (!matStart || !matEnd) {
      const now = new Date();
      matStart = new Date(now.getFullYear(), now.getMonth(), 1);
      matEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    let materialLogs: any[] = [];
    try {
      if (db) {
        materialLogs = await db.collection('ProductionLog').find({
          createdAt: { $gte: matStart, $lte: matEnd },
          transactionType: { $in: ['IN', 'OUT'] },
          approvalStatus: { $ne: 'rejected' },
          $or: [
            { assigneeType: 'vendor' },
            { vendorId: { $exists: true, $ne: null } }
          ]
        }).toArray();
      } else {
        materialLogs = await prisma.productionLog.findMany({
          where: {
            createdAt: { gte: matStart, lte: matEnd },
            transactionType: { in: ['IN', 'OUT'] },
            approvalStatus: { not: 'rejected' },
            vendorId: { not: null }
          }
        });
      }
    } catch (e) {
      console.warn('Failed to query ProductionLog for Month material:', e);
    }

    let outwardSum = 0;
    let inwardSum = 0;
    for (const log of materialLogs) {
      if (log.assigneeType !== 'vendor' && !log.vendorId) continue;
      if (log.approvalStatus === 'rejected') continue;
      const qty = Math.round(Number(log.quantityProduced) || 0);
      if (log.transactionType === 'OUT') outwardSum += qty;
      else if (log.transactionType === 'IN') inwardSum += qty;
    }
    const materialOutwardMonth = outwardSum;
    const materialInwardMonth = inwardSum;
    const filteredElec = electricity.filter(e => {
       if (!fy) return true;
       const eYear = parseInt(e.month.split('-')[0] as string);
       const eMonth = parseInt(e.month.split('-')[1] as string) - 1; // 0-11
       const startYear = parseInt((fy as string).split('-')[0] as string);
       const endYear = parseInt((fy as string).split('-')[1] as string);
       if (eMonth >= 3) return eYear === startYear;
       return eYear === endYear;
    });
    const electricityCost = filteredElec.reduce((acc, curr) => acc + (curr.totalBill || 0), 0);
    const netProfit = totalRevenue - (laborCost + factoryExpenses + electricityCost);

    const summaryData = {
      totalLeads,
      activeProjects,
      completedProjects,
      totalOrders: activeProjects + completedProjects,
      pendingQuotations,
      readyForDispatch,
      totalRevenue,
      advancePaidTotal,
      pendingInvoicesTotal,
      pettyCashInHand,
      materialOutwardMonth,
      materialInwardMonth,
      factoryExpenses,
      profitability: {
        totalRevenue,
        laborCost,
        factoryExpenses,
        electricityCost,
        netProfit
      }
    };

    fastCache.set(cacheKey, summaryData, 30);
    res.json(summaryData);
  } catch (error: any) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard summary', error: error.message });
  }
});

// A simple mock for downloading reports
router.get('/export/:type', authenticate, async (req, res) => {
  try {
    const { type } = req.params;
    // In a real app, generate PDF/Excel using pdfmake or exceljs here and return buffer
    res.json({ message: `Export for ${type} generated successfully (Mock)` });
  } catch (error) {
    res.status(500).json({ message: 'Server error exporting data' });
  }
});

export default router;

