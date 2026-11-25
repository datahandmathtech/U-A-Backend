"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const projectSync_1 = require("../utils/projectSync");
const router = (0, express_1.Router)();
// Get Project Closures
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const closures = await index_1.prisma.projectClosure.findMany({
            orderBy: { createdAt: 'desc' },
            include: { project: { select: { name: true } } }
        });
        res.json(closures);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching closures' });
    }
});
// Create Closure
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, deliveryDate, clientFeedback, rating } = req.body;
        const newClosure = await index_1.prisma.projectClosure.create({
            data: {
                projectId,
                deliveryDate: new Date(deliveryDate),
                clientFeedback,
                rating: Number(rating),
                status: 'closed'
            }
        });
        // Also update project status to completed
        await index_1.prisma.project.update({
            where: { id: projectId },
            data: { status: 'completed' }
        });
        (0, projectSync_1.invalidateProjectCaches)(projectId);
        res.status(201).json(newClosure);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating project closure' });
    }
});
exports.default = router;
//# sourceMappingURL=closureRoutes.js.map