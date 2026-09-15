"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get live factory feed (Machine Logs for Selected Date) - Optimized with fast in-memory cache
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const dateParam = req.query.date || '';
        const cacheKey = `live_feed_${dateParam}`;
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }
        let startOfDay;
        let endOfDay;
        if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
            const parts = dateParam.split('-').map(Number);
            const y = parts[0] || 2026;
            const m = parts[1] || 1;
            const d = parts[2] || 1;
            startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
            endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
        }
        else {
            const now = new Date();
            startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        }
        const dateWhere = {
            startTime: { lte: endOfDay },
            OR: [
                { endTime: { gte: startOfDay } },
                { endTime: null },
                { status: 'active' }
            ]
        };
        const liveFeedLogs = await index_1.prisma.machineLog.findMany({
            where: dateWhere,
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
                machine: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                        status: true
                    }
                },
                operator: {
                    select: {
                        id: true,
                        name: true,
                        staffId: true,
                        role: true,
                        department: true
                    }
                },
                project: {
                    select: {
                        id: true,
                        name: true,
                        projectId: true,
                        clientName: true
                    }
                }
            },
            orderBy: { startTime: 'desc' }
        });
        // Batch lookup root parent logs to resolve true original First ON date & operator
        const parentIds = Array.from(new Set(liveFeedLogs.map((l) => l.parentLogId).filter(Boolean)));
        const rootParentsMap = new Map();
        if (parentIds.length > 0) {
            const parentLogs = await index_1.prisma.machineLog.findMany({
                where: { id: { in: parentIds } },
                select: {
                    id: true,
                    startTime: true,
                    parentLogId: true,
                    operator: { select: { id: true, name: true, staffId: true } }
                }
            });
            parentLogs.forEach((p) => rootParentsMap.set(p.id, p));
        }
        const enrichedLogs = liveFeedLogs.map((log) => {
            let rootParent = log.parentLogId ? rootParentsMap.get(log.parentLogId) : null;
            // If rootParent itself had a parent, look up or fallback
            const initialStartTime = rootParent?.startTime || log.startTime;
            const initialOperator = rootParent?.operator || log.operator;
            return {
                ...log,
                initialStartTime,
                initialOperator
            };
        });
        fastCache_1.fastCache.set(cacheKey, enrichedLogs, 6);
        res.json(enrichedLogs);
    }
    catch (error) {
        console.error('Live Feed Error:', error);
        res.status(500).json({ message: 'Server error fetching live feed' });
    }
});
exports.default = router;
//# sourceMappingURL=liveFeedRoutes.js.map