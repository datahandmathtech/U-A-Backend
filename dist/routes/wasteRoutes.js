"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const prisma = new client_1.PrismaClient();
const router = (0, express_1.Router)();
// Get all waste materials (ProjectMaterials with wasteQuantity > 0)
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { month, year } = req.query;
        const whereClause = {
            wasteQuantity: { gt: 0 }
        };
        if (month && year) {
            const startDate = new Date(Number(year), Number(month) - 1, 1);
            const endDate = new Date(Number(year), Number(month), 1);
            whereClause.addedAt = {
                gte: startDate,
                lt: endDate
            };
        }
        const wasteMaterials = await prisma.projectMaterial.findMany({
            where: whereClause,
            include: {
                project: { select: { name: true, projectId: true } },
                inventory: { select: { itemName: true, type: true, supplier: true } }
            },
            orderBy: { addedAt: 'desc' }
        });
        res.json(wasteMaterials);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching waste materials' });
    }
});
exports.default = router;
//# sourceMappingURL=wasteRoutes.js.map