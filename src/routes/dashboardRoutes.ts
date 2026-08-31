import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

router.get('/summary', authenticate, async (req, res) => {
  try {
    const { fy, month } = req.query;
    
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

    const totalLeads = await prisma.lead.count({ where: dateFilter });
    const activeProjects = await prisma.project.count({ where: { status: 'in_progress', ...dateFilter } });
    
    const invoices = await prisma.invoice.findMany({ where: dateFilter, select: { totalAmount: true, balanceAmount: true } });
    const totalRevenue = invoices.reduce((acc, curr) => acc + curr.totalAmount, 0);
    const pendingInvoicesTotal = invoices.reduce((acc, curr) => acc + curr.balanceAmount, 0);
    
    const readyForDispatch = await prisma.crate.count({ where: { status: 'packing', ...dateFilter } });
    
    // Profitability Analysis
    const laborContracts = await prisma.laborContract.findMany({ where: dateFilter });
    const laborCost = laborContracts.reduce((acc, curr) => acc + curr.totalAmount, 0);
    
    // Expense date filter (it uses 'date' instead of 'createdAt')
    let expenseFilter = {};
    if (dateFilter.createdAt) {
      expenseFilter = { date: dateFilter.createdAt };
    }
    const expenses = await prisma.expense.findMany({ where: expenseFilter });
    const factoryExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    
    // Electricity uses month string (e.g. "2026-06"). It's hard to filter easily by exact dates, we'll try basic filtering
    // or just fetch all and filter in memory since there's one per month
    const electricity = await prisma.electricityLog.findMany();
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
    const electricityCost = filteredElec.reduce((acc, curr) => acc + curr.totalBill, 0);

    const netProfit = totalRevenue - (laborCost + factoryExpenses + electricityCost);

    res.json({
      totalLeads,
      activeProjects,
      totalRevenue,
      pendingInvoicesTotal,
      readyForDispatch,
      profitability: {
        laborCost,
        factoryExpenses,
        electricityCost,
        netProfit
      }
    });
  } catch (error: any) {
    console.error(error);
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
