"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
router.get('/summary', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { fy, month } = req.query;
        let dateFilter = {};
        if (fy && typeof fy === 'string') {
            const startYear = parseInt(fy.split('-')[0]);
            const endYear = parseInt(fy.split('-')[1]);
            let startDate, endDate;
            if (month && month !== '') {
                const monthNum = parseInt(month);
                const year = (monthNum >= 3 && monthNum <= 11) ? startYear : endYear;
                startDate = new Date(year, monthNum, 1);
                endDate = new Date(year, monthNum + 1, 0, 23, 59, 59, 999);
            }
            else {
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
        // Expense date filter (it uses 'date' instead of 'createdAt')
        let expenseFilter = {};
        if (dateFilter.createdAt) {
            expenseFilter = { date: dateFilter.createdAt };
        }
        const [totalLeads, activeProjects, invoices, readyForDispatch, laborContracts, expenses, electricity] = await Promise.all([
            index_1.prisma.lead.count({ where: dateFilter }),
            index_1.prisma.project.count({ where: { status: 'in_progress', ...dateFilter } }),
            index_1.prisma.invoice.findMany({ where: dateFilter, select: { totalAmount: true, balanceAmount: true } }),
            index_1.prisma.crate.count({ where: { status: 'packing', ...dateFilter } }),
            index_1.prisma.laborContract.findMany({ where: dateFilter, select: { totalAmount: true } }),
            index_1.prisma.expense.findMany({ where: expenseFilter, select: { amount: true } }),
            index_1.prisma.electricityLog.findMany({ select: { month: true, totalBill: true } })
        ]);
        const totalRevenue = invoices.reduce((acc, curr) => acc + curr.totalAmount, 0);
        const pendingInvoicesTotal = invoices.reduce((acc, curr) => acc + curr.balanceAmount, 0);
        const laborCost = laborContracts.reduce((acc, curr) => acc + curr.totalAmount, 0);
        const factoryExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);
        const filteredElec = electricity.filter(e => {
            if (!fy)
                return true;
            const eYear = parseInt(e.month.split('-')[0]);
            const eMonth = parseInt(e.month.split('-')[1]) - 1; // 0-11
            const startYear = parseInt(fy.split('-')[0]);
            const endYear = parseInt(fy.split('-')[1]);
            if (month && month !== '') {
                return eYear === ((parseInt(month) >= 3 && parseInt(month) <= 11) ? startYear : endYear) && eMonth === parseInt(month);
            }
            if (eMonth >= 3)
                return eYear === startYear;
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching dashboard summary', error: error.message });
    }
});
// A simple mock for downloading reports
router.get('/export/:type', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { type } = req.params;
        // In a real app, generate PDF/Excel using pdfmake or exceljs here and return buffer
        res.json({ message: `Export for ${type} generated successfully (Mock)` });
    }
    catch (error) {
        res.status(500).json({ message: 'Server error exporting data' });
    }
});
exports.default = router;
//# sourceMappingURL=dashboardRoutes.js.map