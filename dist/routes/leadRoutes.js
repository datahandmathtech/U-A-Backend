"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get all leads
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cached = fastCache_1.fastCache.get('all_leads');
        if (cached)
            return res.json(cached);
        const leads = await index_1.prisma.lead.findMany({
            orderBy: { createdAt: 'desc' },
            include: { assignedTo: { select: { name: true } } }
        });
        fastCache_1.fastCache.set('all_leads', leads, 120);
        res.json(leads);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching leads' });
    }
});
// Create a new lead
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { clientName, contact, email, source, architect, designer, status, notes, assignedToId } = req.body;
        const newLead = await index_1.prisma.lead.create({
            data: {
                clientName,
                contact,
                email,
                source,
                architect,
                designer,
                status: status || 'new',
                notes,
                assignedToId
            }
        });
        fastCache_1.fastCache.invalidate('all_leads');
        res.status(201).json(newLead);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating lead' });
    }
});
// Update lead status
router.patch('/:id/status', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const updatedLead = await index_1.prisma.lead.update({
            where: { id: id },
            data: { status }
        });
        fastCache_1.fastCache.invalidate('all_leads');
        res.json(updatedLead);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error updating lead' });
    }
});
exports.default = router;
//# sourceMappingURL=leadRoutes.js.map