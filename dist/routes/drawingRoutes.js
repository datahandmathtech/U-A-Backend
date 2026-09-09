"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
const router = express_1.default.Router();
// Get drawings for a project
router.get('/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const drawings = await index_1.prisma.shopDrawing.findMany({
            where: { projectId },
            include: { approvals: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(drawings);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch drawings' });
    }
});
// Add new drawing
router.post('/', async (req, res) => {
    try {
        const { projectId, title, type, fileUrl, comments } = req.body;
        // Check if drawing with same title exists to increment version
        const existing = await index_1.prisma.shopDrawing.findFirst({
            where: { projectId, title },
            orderBy: { version: 'desc' }
        });
        const version = existing ? existing.version + 1 : 1;
        const drawing = await index_1.prisma.shopDrawing.create({
            data: {
                projectId,
                title,
                type,
                fileUrl,
                comments,
                version
            }
        });
        res.status(201).json(drawing);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to upload drawing' });
    }
});
// Approve/Reject drawing
router.post('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { approvedBy, status, notes } = req.body; // status: Approved, Rejected, Changes Requested
        const drawing = await index_1.prisma.shopDrawing.findUnique({ where: { id } });
        if (!drawing)
            return res.status(404).json({ error: 'Drawing not found' });
        // Update drawing status
        const updatedDrawing = await index_1.prisma.shopDrawing.update({
            where: { id },
            data: { status }
        });
        // Create Approval record
        const approval = await index_1.prisma.approvalRecord.create({
            data: {
                projectId: drawing.projectId,
                shopDrawingId: id,
                approvedBy,
                status,
                notes
            }
        });
        res.json({ drawing: updatedDrawing, approval });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to update approval status' });
    }
});
// Edit drawing
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, comments } = req.body;
        const updated = await index_1.prisma.shopDrawing.update({
            where: { id },
            data: { title, comments }
        });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to update drawing' });
    }
});
// Delete drawing
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // First delete any approval records associated with it
        await index_1.prisma.approvalRecord.deleteMany({
            where: { shopDrawingId: id }
        });
        await index_1.prisma.shopDrawing.delete({
            where: { id }
        });
        res.json({ message: 'Drawing deleted successfully' });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete drawing' });
    }
});
exports.default = router;
//# sourceMappingURL=drawingRoutes.js.map