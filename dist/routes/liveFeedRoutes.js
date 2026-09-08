"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get live factory feed (Machine Logs for Selected Date) - Optimized for high performance
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const dateParam = req.query.date;
        const queryDate = dateParam ? new Date(dateParam) : new Date();
        const startOfDay = new Date(queryDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(queryDate);
        endOfDay.setHours(23, 59, 59, 999);
        const isToday = queryDate.toDateString() === new Date().toDateString();
        let dateWhere;
        if (isToday) {
            // For today: logs active today, or completed today, or active within recent window
            const recentWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);
            dateWhere = {
                OR: [
                    { startTime: { gte: startOfDay, lte: endOfDay } },
                    { endTime: { gte: startOfDay, lte: endOfDay } },
                    { status: 'active', startTime: { gte: recentWindow } }
                ]
            };
        }
        else {
            // For past date: logs that were started on that date
            dateWhere = {
                startTime: { gte: startOfDay, lte: endOfDay }
            };
        }
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
            orderBy: { startTime: 'desc' },
            take: 100
        });
        res.json(liveFeedLogs);
    }
    catch (error) {
        console.error('Live Feed Error:', error);
        res.status(500).json({ message: 'Server error fetching live feed' });
    }
});
exports.default = router;
//# sourceMappingURL=liveFeedRoutes.js.map