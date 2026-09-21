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
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const rawLeads = await db.collection('Lead').find({}).sort({ createdAt: -1 }).toArray();
                const userIds = rawLeads.map((l) => l.assignedToId).filter(Boolean);
                const userObjIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
                const rawUsers = await db.collection('User').find({ $or: [{ _id: { $in: userObjIds } }, { id: { $in: userIds } }] }, { projection: { name: 1 } }).toArray();
                const userMap = new Map();
                rawUsers.forEach((u) => userMap.set(u._id.toString(), { name: u.name }));
                const enriched = rawLeads.map((l) => ({
                    ...l,
                    id: l._id.toString(),
                    assignedTo: l.assignedToId ? userMap.get(l.assignedToId) || null : null
                }));
                fastCache_1.fastCache.set('all_leads', enriched, 120);
                return res.json(enriched);
            }
            catch (mErr) {
                console.warn('Mongoose lead fetch failed:', mErr);
            }
        }
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