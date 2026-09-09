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

    // Expense date filter (uses 'date' if present)
    let expenseFilter = {};
    if (dateFilter.createdAt) {
      expenseFilter = { date: dateFilter.createdAt };
    }

    const [
      totalLeads,
      activeProjects,
      pendingQuotations,
      readyForDispatch,
      invoices,
      laborContracts,
      expenses,
      electricity
    ] = await Promise.all([
      // 1. Total Enquiries (CRM Pipeline: enquiry, design_sharing, quotation, advance_payment)
      prisma.project.count({
        where: {
          status: { in: ['enquiry', 'design_sharing', 'quotation', 'advance_payment'] },
          ...dateFilter
        }
      }),
      // 2. Active Work Orders (Production Pipeline: shop_drawing, material_planning, production, work_order)
      prisma.project.count({
        where: {
          status: { in: ['shop_drawing', 'material_planning', 'production', 'work_order'] },
          ...dateFilter
        }
      }),
      // 3. Pending Quotations (Enquiries currently in quotation stage)
      prisma.project.count({
        where: {
          status: 'quotation',
          ...dateFilter
        }
      }),
      // 4. Dispatch Ready (Completed projects)
      prisma.project.count({
        where: {
          status: 'completed',
          ...dateFilter
        }
      }),
      // 5. Financial invoices summary
      prisma.invoice.findMany({
        where: dateFilter,
        select: { totalAmount: true, advancePaid: true, balanceAmount: true }
      }),
      // 6. Labor contracts
      prisma.laborContract.findMany({
        where: dateFilter,
        select: { totalAmount: true }
      }),
      // 7. Factory operational expenses
      prisma.expense.findMany({
        where: expenseFilter,
        select: { amount: true }
      }),
      // 8. Electricity logs
      prisma.electricityLog.findMany({
        select: { month: true, totalBill: true }
      })
    ]);

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

    res.json({
      totalLeads,
      activeProjects,
      pendingQuotations,
      readyForDispatch,
      totalRevenue,
      advancePaidTotal,
      pendingInvoicesTotal: advancePaidTotal > 0 ? advancePaidTotal : pendingInvoicesTotal,
      profitability: {
        laborCost,
        factoryExpenses,
        electricityCost,
        netProfit
      }
    });
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
