"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get machines
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cached = fastCache_1.fastCache.get('all_machines');
        if (cached)
            return res.json(cached);
        let machines = [];
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db && mongoose.connection.readyState === 1) {
            try {
                const raw = await db.collection('Machine').find({}).sort({ createdAt: -1 }).toArray();
                machines = raw.map((m) => ({
                    id: m._id.toString(),
                    name: m.name,
                    type: m.type,
                    hourlyCost: m.hourlyCost,
                    maintenanceIntervalHours: m.maintenanceIntervalHours,
                    status: m.status,
                    createdAt: m.createdAt,
                    updatedAt: m.updatedAt
                }));
            }
            catch (err) {
                console.warn('Mongoose machine query failed:', err);
            }
        }
        if (machines.length === 0) {
            machines = await index_1.prisma.machine.findMany({
                orderBy: { createdAt: 'desc' }
            });
        }
        fastCache_1.fastCache.set('all_machines', machines, 120);
        res.json(machines);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching machines' });
    }
});
// Add machine
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { name, type, hourlyCost, maintenanceIntervalHours } = req.body;
        const newMachine = await index_1.prisma.machine.create({
            data: {
                name,
                type,
                hourlyCost: Number(hourlyCost),
                maintenanceIntervalHours: Number(maintenanceIntervalHours) || 200,
                status: 'active'
            }
        });
        fastCache_1.fastCache.invalidate('all_machines');
        res.status(201).json(newMachine);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating machine' });
    }
});
// Update Machine (e.g. reset maintenance hours)
router.put('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, type, status, hourlyCost, maintenanceIntervalHours, totalRunHours } = req.body;
        const updated = await index_1.prisma.machine.update({
            where: { id: String(id) },
            data: {
                name, type, status,
                hourlyCost: hourlyCost ? Number(hourlyCost) : undefined,
                maintenanceIntervalHours: maintenanceIntervalHours ? Number(maintenanceIntervalHours) : undefined,
                totalRunHours: totalRunHours !== undefined ? Number(totalRunHours) : undefined
            }
        });
        fastCache_1.fastCache.invalidate('all_machines');
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error updating machine' });
    }
});
// Delete Machine
router.delete('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = String(id);
        const machine = await index_1.prisma.machine.findUnique({
            where: { id: machineId }
        });
        if (!machine) {
            return res.status(404).json({ message: 'Machine not found or already deleted' });
        }
        // Cascade / Unlink relations safely
        await Promise.allSettled([
            index_1.prisma.machineLog.deleteMany({ where: { machineId } }),
            index_1.prisma.pieceLog.updateMany({ where: { machineId }, data: { machineId: null } }),
            index_1.prisma.productionLog.updateMany({ where: { machineId }, data: { machineId: null } }),
            index_1.prisma.attendance.updateMany({ where: { machineId }, data: { machineId: null } })
        ]);
        await index_1.prisma.machine.delete({ where: { id: machineId } });
        fastCache_1.fastCache.invalidate('all_machines');
        res.json({ message: 'Machine deleted successfully' });
    }
    catch (error) {
        console.error('Server error deleting machine:', error);
        res.status(500).json({ message: 'Server error deleting machine', error: error?.message || error });
    }
});
exports.default = router;
//# sourceMappingURL=machineRoutes.js.map