"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get dispatches
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const rawDispatches = await db.collection('Dispatch').find({}).sort({ createdAt: -1 }).toArray();
                const dispIds = rawDispatches.map((d) => d._id.toString());
                const projIds = rawDispatches.map((d) => d.projectId).filter(Boolean);
                const projObjIds = projIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
                const [rawProjects, rawCrates] = await Promise.all([
                    db.collection('Project').find({ $or: [{ _id: { $in: projObjIds } }, { id: { $in: projIds } }] }, { projection: { name: 1 } }).toArray(),
                    db.collection('Crate').find({ dispatchId: { $in: dispIds } }).toArray()
                ]);
                const projMap = new Map();
                rawProjects.forEach((p) => projMap.set(p._id.toString(), { name: p.name }));
                const crateMap = new Map();
                rawCrates.forEach((c) => {
                    if (!crateMap.has(c.dispatchId))
                        crateMap.set(c.dispatchId, []);
                    crateMap.get(c.dispatchId).push({ ...c, id: c._id.toString() });
                });
                const enriched = rawDispatches.map((d) => ({
                    ...d,
                    id: d._id.toString(),
                    project: d.projectId ? projMap.get(d.projectId) || null : null,
                    crates: crateMap.get(d._id.toString()) || []
                }));
                return res.json(enriched);
            }
            catch (mErr) {
                console.warn('Mongoose dispatch fetch failed:', mErr);
            }
        }
        const dispatches = await index_1.prisma.dispatch.findMany({
            orderBy: { createdAt: 'desc' },
            include: { project: { select: { name: true } }, crates: true }
        });
        res.json(dispatches);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching dispatches' });
    }
});
// Create Dispatch
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, vehicleNumber, driverDetails, lrNumber } = req.body;
        const newDispatch = await index_1.prisma.dispatch.create({
            data: {
                projectId,
                vehicleNumber,
                driverDetails,
                lrNumber,
                status: 'in_transit'
            }
        });
        res.status(201).json(newDispatch);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating dispatch' });
    }
});
exports.default = router;
//# sourceMappingURL=dispatchRoutes.js.map