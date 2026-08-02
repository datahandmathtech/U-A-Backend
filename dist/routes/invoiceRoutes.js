"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get invoices
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const invoices = await index_1.prisma.invoice.findMany({
            orderBy: { createdAt: 'desc' },
            include: { project: { select: { projectId: true, name: true } } }
        });
        res.json(invoices);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching invoices' });
    }
});
// Create Invoice
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, totalAmount, advancePaid, dueDate, paymentMethod, paymentDate } = req.body;
        const latestInvoice = await index_1.prisma.invoice.findFirst({
            orderBy: { invoiceNumber: 'desc' },
            select: { invoiceNumber: true }
        });
        let nextNumber = 1;
        if (latestInvoice && latestInvoice.invoiceNumber) {
            const match = latestInvoice.invoiceNumber.match(/INV-\d{4}-(\d+)/);
            if (match && match[1]) {
                nextNumber = parseInt(match[1], 10) + 1;
            }
        }
        const invoiceNumber = `INV-${new Date().getFullYear()}-${String(nextNumber).padStart(4, '0')}`;
        const balanceAmount = Number(totalAmount) - Number(advancePaid || 0);
        let status = 'unpaid';
        if (balanceAmount <= 0)
            status = 'paid';
        else if (Number(advancePaid) > 0)
            status = 'partial';
        const newInvoice = await index_1.prisma.invoice.create({
            data: {
                projectId,
                invoiceNumber,
                totalAmount: Number(totalAmount),
                advancePaid: Number(advancePaid || 0),
                balanceAmount,
                dueDate: dueDate ? new Date(dueDate) : null,
                paymentMethod,
                paymentDate: paymentDate ? new Date(paymentDate) : null,
                status
            }
        });
        res.status(201).json(newInvoice);
    }
    catch (error) {
        console.error('Invoice creation error:', error);
        res.status(500).json({ message: 'Server error creating invoice' });
    }
});
exports.default = router;
//# sourceMappingURL=invoiceRoutes.js.map