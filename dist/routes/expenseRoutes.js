"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get expenses
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const expenses = await index_1.prisma.expense.findMany({
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { name: true } } }
        });
        res.json(expenses);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching expenses' });
    }
});
// Create expense
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { category, amount, description, date } = req.body;
        const paidBy = req.user?.id;
        const newExpense = await index_1.prisma.expense.create({
            data: {
                category,
                amount: Number(amount),
                description,
                date: date ? new Date(date) : new Date(),
                paidBy
            }
        });
        fastCache_1.fastCache.invalidate('dashboard_summary');
        res.status(201).json(newExpense);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating expense' });
    }
});
exports.default = router;
//# sourceMappingURL=expenseRoutes.js.map