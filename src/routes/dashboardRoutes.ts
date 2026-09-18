import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

router.get('/summary', authenticate, async (req, res) => {
  try {
    const { fy, month } = req.query;
    const cacheKey = `dashboard_summary_${fy || 'all'}_${month || 'all'}`;
    const cached = fastCache.get(cacheKey);
    if (cached) return res.json(cached);
    
    let dateFilter: any = {};
    if (fy && typeof fy === 'string') {
      const startYear = parseInt((fy as string).split('-')[0] as string);
      const endYear = parseInt((fy as string).split('-')[1] as string);
      let startDate, endDate;
      
      if (month && month !== '') {
        const monthNum = parseInt(month as string);
        const year = (monthNum >= 3 && monthNum <= 11) ? startYear : endYear;
        startDate = new Date(year, monthNum, 1);
        endDate = new Date(year, monthNum + 1, 0, 23, 59, 59, 999);
      } else {
        startDate = new Date(startYear, 3, 1);
        endDate = new Date(endYear, 2, 31, 23, 59, 59, 999);
      }
      dateFilter = {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      };
    }

    // Expense date filter (uses 'date' if present)
    let expenseFilter = {};
    if (dateFilter.createdAt) {
      expenseFilter = { date: dateFilter.createdAt };
    }

    const [projects, invoices, laborContracts, expenses, electricity] = await Promise.all([
      prisma.project.findMany({
        where: dateFilter,
        select: { status: true }
      }),
      prisma.invoice.findMany({
        where: dateFilter,
        select: { totalAmount: true, advancePaid: true, balanceAmount: true }
      }),
      prisma.laborContract.findMany({
        where: dateFilter,
        select: { totalAmount: true }
      }),
      prisma.expense.findMany({
        where: expenseFilter,
        select: { amount: true }
      }),
      prisma.electricityLog.findMany({
        select: { month: true, totalBill: true }
      })
    ]);

    let totalLeads = 0;
    let activeProjects = 0;
    let pendingQuotations = 0;
    let readyForDispatch = 0;

    for (const p of projects) {
      if (['enquiry', 'design_sharing', 'quotation', 'advance_payment'].includes(p.status)) totalLeads++;
      if (['shop_drawing', 'material_planning', 'production', 'work_order'].includes(p.status)) activeProjects++;
      if (p.status === 'quotation') pendingQuotations++;
      if (p.status === 'completed') readyForDispatch++;
    }

    const totalRevenue = invoices.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
    const advancePaidTotal = invoices.reduce((acc, curr) => acc + (curr.advancePaid || 0), 0);
    const pendingInvoicesTotal = invoices.reduce((acc, curr) => acc + (curr.balanceAmount || 0), 0);
    const laborCost = laborContracts.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
    const factoryExpenses = expenses.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const filteredElec = electricity.filter(e => {
       if (!fy) return true;
       const eYear = parseInt(e.month.split('-')[0] as string);
       const eMonth = parseInt(e.month.split('-')[1] as string) - 1; // 0-11
       const startYear = parseInt((fy as string).split('-')[0] as string);
       const endYear = parseInt((fy as string).split('-')[1] as string);
       if (month && month !== '') {
          return eYear === ((parseInt(month as string) >= 3 && parseInt(month as string) <= 11) ? startYear : endYear) && eMonth === parseInt(month as string);
       }
       if (eMonth >= 3) return eYear === startYear;
       return eYear === endYear;
    });
    const electricityCost = filteredElec.reduce((acc, curr) => acc + (curr.totalBill || 0), 0);
    const netProfit = totalRevenue - (laborCost + factoryExpenses + electricityCost);

    const summaryData = {
      totalLeads,
      activeProjects,
      pendingQuotations,
      readyForDispatch,
      totalRevenue,
      advancePaidTotal,
      pendingInvoicesTotal: advancePaidTotal > 0 ? advancePaidTotal : pendingInvoicesTotal,
      profitability: {
        totalRevenue,
        laborCost,
        factoryExpenses,
        electricityCost,
        netProfit
      }
    };

    fastCache.set(cacheKey, summaryData, 120);
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
