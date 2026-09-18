"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
router.get('/summary', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { fy, month } = req.query;
        const cacheKey = `dashboard_summary_${fy || 'all'}_${month || 'all'}`;
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
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
        // Expense date filter (uses 'date' if present)
        let expenseFilter = {};
        if (dateFilter.createdAt) {
            expenseFilter = { date: dateFilter.createdAt };
        }
        let projects = [];
        let invoices = [];
        let laborContracts = [];
        let expenses = [];
        let electricity = [];
        const mongoose = require('mongoose');
        const db = mongoose.connection?.db;
        if (db && mongoose.connection.readyState === 1) {
            try {
                [projects, invoices, laborContracts, expenses, electricity] = await Promise.all([
                    db.collection('Project').find(dateFilter, { projection: { status: 1 } }).toArray(),
                    db.collection('Invoice').find(dateFilter, { projection: { totalAmount: 1, advancePaid: 1, balanceAmount: 1 } }).toArray(),
                    db.collection('LaborContract').find(dateFilter, { projection: { totalAmount: 1 } }).toArray(),
                    db.collection('Expense').find(expenseFilter, { projection: { amount: 1 } }).toArray(),
                    db.collection('ElectricityLog').find({}, { projection: { month: 1, totalBill: 1 } }).toArray()
                ]);
            }
            catch (mErr) {
                console.warn('Mongoose dashboard query failed, falling back to Prisma:', mErr);
            }
        }
        if (projects.length === 0 && invoices.length === 0) {
            [projects, invoices, laborContracts, expenses, electricity] = await Promise.all([
                index_1.prisma.project.findMany({ where: dateFilter, select: { status: true } }),
                index_1.prisma.invoice.findMany({ where: dateFilter, select: { totalAmount: true, advancePaid: true, balanceAmount: true } }),
                index_1.prisma.laborContract.findMany({ where: dateFilter, select: { totalAmount: true } }),
                index_1.prisma.expense.findMany({ where: expenseFilter, select: { amount: true } }),
                index_1.prisma.electricityLog.findMany({ select: { month: true, totalBill: true } })
            ]);
        }
        let totalLeads = 0;
        let activeProjects = 0;
        let pendingQuotations = 0;
        let readyForDispatch = 0;
        for (const p of projects) {
            if (['enquiry', 'design_sharing', 'quotation', 'advance_payment'].includes(p.status))
                totalLeads++;
            if (['shop_drawing', 'material_planning', 'production', 'work_order'].includes(p.status))
                activeProjects++;
            if (p.status === 'quotation')
                pendingQuotations++;
            if (p.status === 'completed')
                readyForDispatch++;
        }
        const totalRevenue = invoices.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
        const advancePaidTotal = invoices.reduce((acc, curr) => acc + (curr.advancePaid || 0), 0);
        const pendingInvoicesTotal = invoices.reduce((acc, curr) => acc + (curr.balanceAmount || 0), 0);
        const laborCost = laborContracts.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
        const factoryExpenses = expenses.reduce((acc, curr) => acc + (curr.amount || 0), 0);
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
        fastCache_1.fastCache.set(cacheKey, summaryData, 300);
        res.json(summaryData);
    }
    catch (error) {
        console.error('Dashboard summary error:', error);
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