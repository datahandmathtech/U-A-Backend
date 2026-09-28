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
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const pIdQuery = mongoose.Types.ObjectId.isValid(projectId)
                    ? { $in: [projectId, new mongoose.Types.ObjectId(projectId)] }
                    : projectId;
                const rawDrawings = await db.collection('ShopDrawing').find({ projectId: pIdQuery }).sort({ createdAt: -1 }).toArray();
                const drawingObjIds = rawDrawings.map((d) => d._id);
                const drawingStringIds = rawDrawings.map((d) => d._id.toString());
                const rawApprovals = await db.collection('DrawingApproval').find({
                    drawingId: { $in: [...drawingStringIds, ...drawingObjIds] }
                }).toArray();
                const appMap = new Map();
                rawApprovals.forEach((a) => {
                    const key = a.drawingId?.toString();
                    if (!appMap.has(key))
                        appMap.set(key, []);
                    appMap.get(key).push({ ...a, id: a._id.toString() });
                });
                const enriched = rawDrawings.map((d) => ({
                    id: d._id.toString(),
                    projectId: d.projectId?.toString() || d.projectId,
                    title: d.title,
                    type: d.type,
                    fileUrl: d.fileUrl,
                    comments: d.comments,
                    version: d.version,
                    status: d.status,
                    createdAt: d.createdAt,
                    updatedAt: d.updatedAt,
                    approvals: appMap.get(d._id.toString()) || []
                }));
                return res.json(enriched);
            }
            catch (mErr) {
                console.warn('Mongoose drawing fetch failed:', mErr);
            }
        }
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
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            const pId = mongoose.Types.ObjectId.isValid(projectId) ? new mongoose.Types.ObjectId(projectId) : projectId;
            const existing = await db.collection('ShopDrawing').find({
                projectId: { $in: [projectId, pId] },
                title
            }).sort({ version: -1 }).limit(1).toArray();
            const version = existing.length > 0 ? (existing[0].version || 1) + 1 : 1;
            const newDoc = {
                projectId: pId,
                title,
                type,
                fileUrl,
                comments: comments || null,
                version,
                status: 'Pending',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            const result = await db.collection('ShopDrawing').insertOne(newDoc);
            return res.status(201).json({ ...newDoc, id: result.insertedId.toString() });
        }
        // fallback to prisma
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
        console.error('Failed to upload drawing:', err);
        res.status(500).json({ error: 'Failed to upload drawing' });
    }
});
// Approve/Reject drawing
router.post('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { approvedBy, status, notes } = req.body; // status: Approved, Rejected, Changes Requested
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            const objId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
            await db.collection('ShopDrawing').updateOne({ $or: [{ _id: objId }, { _id: id }] }, { $set: { status, updatedAt: new Date() } });
            const drawing = await db.collection('ShopDrawing').findOne({ $or: [{ _id: objId }, { _id: id }] });
            const approvalDoc = {
                projectId: drawing?.projectId,
                drawingId: id,
                shopDrawingId: id,
                approvedBy,
                status,
                notes: notes || null,
                date: new Date()
            };
            await db.collection('DrawingApproval').insertOne(approvalDoc);
            return res.json({ drawing: { ...drawing, id: drawing?._id.toString() }, approval: approvalDoc });
        }
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
        const { title, comments, fileUrl } = req.body;
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            const objId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
            const updateData = {};
            if (title !== undefined)
                updateData.title = title;
            if (comments !== undefined)
                updateData.comments = comments;
            if (fileUrl !== undefined)
                updateData.fileUrl = fileUrl;
            updateData.updatedAt = new Date();
            await db.collection('ShopDrawing').updateOne({ $or: [{ _id: objId }, { _id: id }] }, { $set: updateData });
            const doc = await db.collection('ShopDrawing').findOne({ $or: [{ _id: objId }, { _id: id }] });
            if (doc) {
                return res.json({ ...doc, id: doc._id.toString() });
            }
        }
        const updated = await index_1.prisma.shopDrawing.update({
            where: { id },
            data: { title, comments, ...(fileUrl ? { fileUrl } : {}) }
        });
        res.json(updated);
    }
    catch (err) {
        console.error('Failed to update drawing:', err);
        res.status(500).json({ error: 'Failed to update drawing' });
    }
});
// Delete drawing
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            const objId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
            await db.collection('DrawingApproval').deleteMany({
                $or: [{ drawingId: id }, { drawingId: objId }, { shopDrawingId: id }, { shopDrawingId: objId }]
            });
            await db.collection('ShopDrawing').deleteOne({
                $or: [{ _id: objId }, { _id: id }]
            });
            return res.json({ message: 'Drawing deleted successfully' });
        }
        // First delete any approval records associated with it
        await index_1.prisma.approvalRecord.deleteMany({
            where: { shopDrawingId: id }
        }).catch(() => { });
        await index_1.prisma.shopDrawing.delete({
            where: { id }
        }).catch(() => { });
        res.json({ message: 'Drawing deleted successfully' });
    }
    catch (err) {
        console.error('Failed to delete drawing:', err);
        res.status(500).json({ error: 'Failed to delete drawing' });
    }
});
exports.default = router;
//# sourceMappingURL=drawingRoutes.js.map