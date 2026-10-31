"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// GET all messages for a specific slab/product
router.get('/:slabId', auth_1.authenticate, async (req, res) => {
    try {
        const { slabId } = req.params;
        if (!slabId) {
            return res.status(400).json({ message: 'slabId is required' });
        }
        const messages = await index_1.prisma.productMessage.findMany({
            where: { slabId },
            orderBy: { createdAt: 'asc' }
        });
        const unreadCount = messages.filter(m => !m.isReadByAdmin && m.senderRole !== 'admin').length;
        res.json({
            messages,
            unreadCount
        });
    }
    catch (error) {
        console.error('Error fetching product messages:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch messages' });
    }
});
// POST a new message for a specific slab/product
router.post('/:slabId', auth_1.authenticate, async (req, res) => {
    try {
        const { slabId } = req.params;
        const { projectId, message, attachments = [] } = req.body;
        if (!slabId || !message?.trim()) {
            return res.status(400).json({ message: 'slabId and message are required' });
        }
        // Resolve projectId if not supplied
        let targetProjectId = projectId;
        if (!targetProjectId) {
            const slab = await index_1.prisma.slab.findUnique({
                where: { id: slabId },
                select: { projectId: true }
            });
            if (slab)
                targetProjectId = slab.projectId;
        }
        if (!targetProjectId) {
            return res.status(400).json({ message: 'Associated project not found for slab' });
        }
        const user = req.user;
        const senderRole = user?.role || 'employee';
        const isSenderAdmin = senderRole === 'admin' || senderRole === 'manager';
        const newMsg = await index_1.prisma.productMessage.create({
            data: {
                slabId,
                projectId: targetProjectId,
                senderId: user?.id ? String(user.id) : undefined,
                senderName: user?.name || 'Staff User',
                senderRole,
                message: message.trim(),
                attachments: Array.isArray(attachments) ? attachments : [],
                isReadByAdmin: isSenderAdmin, // Admin's own messages are automatically marked read
                readAt: isSenderAdmin ? new Date() : null
            }
        });
        res.json({
            success: true,
            message: newMsg
        });
    }
    catch (error) {
        console.error('Error posting product message:', error);
        res.status(500).json({ message: error.message || 'Failed to post message' });
    }
});
// PATCH mark all messages in a slab as read (called by Admin/Manager)
router.patch('/read/:slabId', auth_1.authenticate, async (req, res) => {
    try {
        const { slabId } = req.params;
        const user = req.user;
        const result = await index_1.prisma.productMessage.updateMany({
            where: {
                slabId,
                isReadByAdmin: false
            },
            data: {
                isReadByAdmin: true,
                readAt: new Date()
            }
        });
        res.json({
            success: true,
            updatedCount: result.count
        });
    }
    catch (error) {
        console.error('Error marking product messages read:', error);
        res.status(500).json({ message: error.message || 'Failed to update read status' });
    }
});
// GET unread alerts for admin dashboard
router.get('/unread/admin-alerts', auth_1.authenticate, async (req, res) => {
    try {
        // Fetch unread messages from non-admin senders
        const unreadMessages = await index_1.prisma.productMessage.findMany({
            where: {
                isReadByAdmin: false,
                senderRole: { not: 'admin' }
            },
            orderBy: { createdAt: 'desc' },
            include: {
                slab: {
                    select: { id: true, name: true, size: true }
                },
                project: {
                    select: { id: true, name: true, projectId: true, clientName: true }
                }
            }
        });
        // Group by slabId
        const slabMap = new Map();
        for (const msg of unreadMessages) {
            if (!slabMap.has(msg.slabId)) {
                slabMap.set(msg.slabId, {
                    slabId: msg.slabId,
                    slabName: msg.slab?.name || 'Unnamed Product',
                    slabSize: msg.slab?.size || '',
                    projectId: msg.projectId,
                    projectName: msg.project?.name || 'Work Order',
                    workOrderId: msg.project?.projectId || '',
                    clientName: msg.project?.clientName || '',
                    lastMessage: msg.message,
                    lastSenderName: msg.senderName,
                    lastSenderRole: msg.senderRole,
                    lastMessageTime: msg.createdAt,
                    hasAttachments: (msg.attachments && msg.attachments.length > 0) || false,
                    unreadCount: 1
                });
            }
            else {
                const item = slabMap.get(msg.slabId);
                item.unreadCount += 1;
            }
        }
        const alerts = Array.from(slabMap.values());
        res.json({
            totalUnread: unreadMessages.length,
            alertsCount: alerts.length,
            alerts
        });
    }
    catch (error) {
        console.error('Error fetching admin chat alerts:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch alerts' });
    }
});
exports.default = router;
//# sourceMappingURL=productChatRoutes.js.map