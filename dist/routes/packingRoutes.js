"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
// Get packing items for a project
router.get('/:projectId', auth_1.authenticate, async (req, res) => {
    try {
        const items = await prisma.packingItem.findMany({
            where: { projectId: String(req.params.projectId) },
            orderBy: { createdAt: 'desc' }
        });
        res.json(items);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});
// Save/update packing items for a project (bulk upsert)
router.post('/:projectId', auth_1.authenticate, async (req, res) => {
    try {
        const projectId = String(req.params.projectId);
        const { items } = req.body;
        await prisma.packingItem.deleteMany({ where: { projectId } });
        const created = [];
        for (const item of items) {
            const newItem = await prisma.packingItem.create({
                data: {
                    projectId,
                    box: item.box || '',
                    code: item.code || '',
                    subCategory: item.subCategory || undefined,
                    size: item.size || undefined,
                    pcs: item.pcs ? Number(item.pcs) : undefined,
                }
            });
            created.push(newItem);
        }
        res.json(created);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});
// Delete a single packing item
router.delete('/:id', auth_1.authenticate, async (req, res) => {
    try {
        await prisma.packingItem.delete({ where: { id: String(req.params.id) } });
        res.json({ message: 'Deleted' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});
exports.default = router;
//# sourceMappingURL=packingRoutes.js.map