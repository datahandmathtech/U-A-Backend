"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get live factory feed (Machine Logs for Selected Date)
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const dateParam = req.query.date;
        const queryDate = dateParam ? new Date(dateParam) : new Date();
        const startOfDay = new Date(queryDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(queryDate);
        endOfDay.setHours(23, 59, 59, 999);
        const liveFeedLogs = await index_1.prisma.machineLog.findMany({
            where: {
                startTime: { lte: endOfDay },
                OR: [
                    { endTime: { gte: startOfDay } },
                    { endTime: null },
                    { status: 'active' }
                ]
            },
            include: {
                machine: true,
                operator: { select: { name: true, staffId: true, role: true, department: true } },
                project: { select: { name: true, projectId: true, clientName: true } }
            },
            orderBy: { startTime: 'desc' }
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