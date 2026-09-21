"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get Machine Logs
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cached = fastCache_1.fastCache.get('all_machine_logs');
        if (cached)
            return res.json(cached);
        let logs = [];
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (!db || mongoose.connection.readyState !== 1) {
            try {
                const directUri = process.env.DATABASE_URL || 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?ssl=true&replicaSet=atlas-icn4hi-shard-0&authSource=admin&retryWrites=true&w=majority&readPreference=primaryPreferred';
                const conn = await mongoose.createConnection(directUri, { serverSelectionTimeoutMS: 3000 }).asPromise();
                db = conn.db;
            }
            catch (err) {
                console.warn('Could not establish dedicated Mongoose connection:', err);
            }
        }
        if (db) {
            try {
                const rawLogs = await db.collection('MachineLog').find({}).sort({ createdAt: -1 }).toArray();
                const machineIds = rawLogs.map((l) => l.machineId).filter(Boolean);
                const projectIds = rawLogs.map((l) => l.projectId).filter(Boolean);
                const operatorIds = rawLogs.map((l) => l.operatorId).filter(Boolean);
                const [rawMachines, rawProjects, rawUsers] = await Promise.all([
                    db.collection('Machine').find({ _id: { $in: machineIds.map((id) => { try {
                                return new mongoose.Types.ObjectId(id);
                            }
                            catch {
                                return id;
                            } }) } }).toArray(),
                    db.collection('Project').find({ _id: { $in: projectIds.map((id) => { try {
                                return new mongoose.Types.ObjectId(id);
                            }
                            catch {
                                return id;
                            } }) } }).toArray(),
                    db.collection('User').find({ _id: { $in: operatorIds.map((id) => { try {
                                return new mongoose.Types.ObjectId(id);
                            }
                            catch {
                                return id;
                            } }) } }).toArray()
                ]);
                const machineMap = new Map();
                rawMachines.forEach((m) => machineMap.set(m._id.toString(), { id: m._id.toString(), name: m.name, type: m.type }));
                const projectMap = new Map();
                rawProjects.forEach((p) => projectMap.set(p._id.toString(), { id: p._id.toString(), name: p.name, projectId: p.projectId, clientName: p.clientName }));
                const userMap = new Map();
                rawUsers.forEach((u) => userMap.set(u._id.toString(), { id: u._id.toString(), name: u.name, staffId: u.staffId }));
                logs = rawLogs.map((l) => ({
                    id: l._id.toString(),
                    machineId: l.machineId,
                    projectId: l.projectId,
                    productId: l.productId,
                    productName: l.productName,
                    startTime: l.startTime,
                    endTime: l.endTime,
                    estimatedHours: l.estimatedHours,
                    downtime: l.downtime,
                    quantityProduced: l.quantityProduced,
                    operatorId: l.operatorId,
                    machinePhotoUrl: l.machinePhotoUrl,
                    unitPhotoUrl: l.unitPhotoUrl,
                    softwarePhotoUrl: l.softwarePhotoUrl,
                    endMachinePhotoUrl: l.endMachinePhotoUrl,
                    endUnitPhotoUrl: l.endUnitPhotoUrl,
                    endSoftwarePhotoUrl: l.endSoftwarePhotoUrl,
                    status: l.status,
                    approvalStatus: l.approvalStatus,
                    isCarryForward: l.isCarryForward,
                    parentLogId: l.parentLogId,
                    remarks: l.remarks,
                    createdAt: l.createdAt,
                    machine: l.machineId ? machineMap.get(l.machineId.toString()) : null,
                    project: l.projectId ? projectMap.get(l.projectId.toString()) : null,
                    operator: l.operatorId ? userMap.get(l.operatorId.toString()) : null
                }));
            }
            catch (err) {
                console.warn('Mongoose machine log query failed, falling back to Prisma:', err);
            }
        }
        if (logs.length === 0) {
            logs = await index_1.prisma.machineLog.findMany({
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    machineId: true,
                    projectId: true,
                    productId: true,
                    productName: true,
                    startTime: true,
                    endTime: true,
                    estimatedHours: true,
                    downtime: true,
                    quantityProduced: true,
                    operatorId: true,
                    machinePhotoUrl: true,
                    unitPhotoUrl: true,
                    softwarePhotoUrl: true,
                    endMachinePhotoUrl: true,
                    endUnitPhotoUrl: true,
                    endSoftwarePhotoUrl: true,
                    status: true,
                    approvalStatus: true,
                    isCarryForward: true,
                    parentLogId: true,
                    remarks: true,
                    createdAt: true,
                    machine: { select: { id: true, name: true, type: true } },
                    project: { select: { id: true, name: true, projectId: true, clientName: true } },
                    operator: { select: { id: true, name: true, staffId: true } }
                }
            });
        }
        fastCache_1.fastCache.set('all_machine_logs', logs, 120);
        res.json(logs);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching machine logs' });
    }
});
// Live Feed Endpoint
router.get('/live-feed', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const activeLogs = await index_1.prisma.machineLog.findMany({
            where: { status: 'active' },
            orderBy: { startTime: 'desc' },
            include: {
                machine: { select: { name: true, type: true } },
                project: { select: { name: true, projectId: true, requirements: true } },
                operator: { select: { name: true, staffId: true } }
            }
        });
        res.json(activeLogs);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching live feed' });
    }
});
// Create Machine Log
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { machineId, projectId, startTime, downtime, remarks } = req.body;
        const operatorId = req.user?.id;
        const newLog = await index_1.prisma.machineLog.create({
            data: {
                machineId,
                projectId: projectId || null,
                startTime: new Date(startTime),
                downtime: Number(downtime || 0),
                remarks,
                operatorId
            }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.status(201).json(newLog);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error creating machine log' });
    }
});
// Machine Clock-In (One-Step workflow for worker)
router.post('/clock-in', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { machineId, machinePhotoUrl, unitPhotoUrl, softwarePhotoUrl, remarks, projectId, productId, productName, estimatedHours } = req.body;
        const operatorId = req.user?.id;
        const newLog = await index_1.prisma.machineLog.create({
            data: {
                machineId,
                startTime: new Date(),
                estimatedHours: estimatedHours ? Number(estimatedHours) : null,
                machinePhotoUrl,
                unitPhotoUrl,
                softwarePhotoUrl,
                remarks,
                operatorId,
                projectId,
                productId,
                productName,
                status: 'active',
                approvalStatus: 'in_progress'
            }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.status(201).json(newLog);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during machine clock-in' });
    }
});
// Get ALL Machine Logs for Today
router.get('/daily-logs', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const dailyLogs = await index_1.prisma.machineLog.findMany({
            where: {
                OR: [
                    { startTime: { gte: startOfDay } },
                    { status: 'active' }
                ]
            },
            orderBy: { startTime: 'desc' },
            include: {
                machine: { select: { name: true } },
                project: { select: { name: true, projectId: true, clientName: true } },
                operator: { select: { name: true, staffId: true } }
            }
        });
        res.json(dailyLogs);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching daily machine logs' });
    }
});
// Machine Clock-Out (Any user can end an active log)
router.post('/clock-out', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { logId, remarks, endMachinePhotoUrl, endUnitPhotoUrl, endSoftwarePhotoUrl, quantityProduced } = req.body;
        let log = await index_1.prisma.machineLog.findFirst({
            where: { id: logId, status: 'active' }
        });
        if (!log) {
            // If the log was split, find the machine's current active log
            const originalLog = await index_1.prisma.machineLog.findUnique({
                where: { id: logId }
            });
            if (originalLog) {
                log = await index_1.prisma.machineLog.findFirst({
                    where: { machineId: originalLog.machineId, status: 'active' }
                });
            }
        }
        if (!log)
            return res.status(404).json({ message: 'Active machine log not found' });
        const endTime = new Date();
        const hours = (endTime.getTime() - log.startTime.getTime()) / (1000 * 60 * 60);
        const updatedLog = await index_1.prisma.machineLog.update({
            where: { id: log.id },
            data: {
                endTime: endTime,
                status: 'completed',
                approvalStatus: 'pending',
                remarks: remarks ? `${log.remarks || ''}\nOut: ${remarks}`.trim() : log.remarks,
                endMachinePhotoUrl,
                endUnitPhotoUrl,
                endSoftwarePhotoUrl,
                quantityProduced: quantityProduced ? parseFloat(quantityProduced) : 1
            }
        });
        await index_1.prisma.machine.update({
            where: { id: log.machineId },
            data: { totalRunHours: { increment: hours } }
        });
        // Also create a production log so it goes to the Admin Approvals tab
        await index_1.prisma.productionLog.create({
            data: {
                projectId: log.projectId,
                productId: log.productId,
                productName: log.productName,
                machineId: log.machineId,
                stage: 'Production Work',
                quantityProduced: quantityProduced ? parseFloat(quantityProduced) : 1,
                transactionType: 'IN',
                startPhotos: {
                    machine: endMachinePhotoUrl,
                    unit: endUnitPhotoUrl,
                    software: endSoftwarePhotoUrl
                },
                workerId: log.operatorId,
                parentLogId: log.id,
                approvalStatus: 'pending',
                status: 'completed',
                remarks: remarks || log.remarks || undefined
            }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.json(updatedLog);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during machine clock-out' });
    }
});
// Admin: Approve Log
router.put('/approve/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, productId, productName } = req.body;
        const updated = await index_1.prisma.machineLog.update({
            where: { id: req.params.id },
            data: { approvalStatus: 'approved', projectId, productId, productName }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error approving log' });
    }
});
// Admin: Reject Log
router.put('/reject/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const updated = await index_1.prisma.machineLog.update({
            where: { id: req.params.id },
            data: { approvalStatus: 'rejected', status: 'completed', endTime: new Date() }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error rejecting log' });
    }
});
// Admin: Edit Log
router.put('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { quantityProduced, remarks, projectId, productId, productName } = req.body;
        const updated = await index_1.prisma.machineLog.update({
            where: { id: req.params.id },
            data: {
                quantityProduced: quantityProduced ? Number(quantityProduced) : undefined,
                remarks: remarks !== undefined ? String(remarks) : undefined,
                projectId: projectId ? String(projectId) : undefined,
                productId: productId ? String(productId) : undefined,
                productName: productName ? String(productName) : undefined
            }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error editing log' });
    }
});
// Admin: Delete Log
router.delete('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        await index_1.prisma.machineLog.delete({
            where: { id: req.params.id }
        });
        fastCache_1.fastCache.invalidate('all_machine_logs');
        fastCache_1.fastCache.invalidate('live_feed');
        res.json({ message: 'Machine log deleted successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error deleting log' });
    }
});
exports.default = router;
//# sourceMappingURL=machineLogRoutes.js.map