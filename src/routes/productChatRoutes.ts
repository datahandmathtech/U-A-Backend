import express from 'express';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// GET all messages for a project (or slab)
router.get('/:slabId', authenticate, async (req: any, res: any) => {
  try {
    const { slabId } = req.params;
    if (!slabId) {
      return res.status(400).json({ message: 'slabId is required' });
    }

    let targetProjectId = slabId;
    const slab = await prisma.slab.findUnique({
      where: { id: slabId },
      select: { projectId: true }
    }).catch(() => null);
    if (slab?.projectId) {
      targetProjectId = slab.projectId;
    }

    const messages = await prisma.productMessage.findMany({
      where: {
        OR: [
          { projectId: targetProjectId },
          { slabId: slabId }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    const unreadCount = messages.filter(m => !m.isReadByAdmin && m.senderRole !== 'admin').length;

    res.json({
      messages,
      unreadCount
    });
  } catch (error: any) {
    console.error('Error fetching product messages:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch messages' });
  }
});

// POST a new message for a project (or slab)
router.post('/:slabId', authenticate, async (req: any, res: any) => {
  try {
    const { slabId } = req.params;
    const { projectId, message, attachments = [] } = req.body;

    if (!slabId || !message?.trim()) {
      return res.status(400).json({ message: 'slabId and message are required' });
    }

    // Resolve projectId and slabId
    let targetProjectId = projectId ? String(projectId) : '';
    let targetSlabId = String(slabId);

    const existingSlab = await prisma.slab.findUnique({
      where: { id: String(slabId) },
      select: { id: true, projectId: true }
    }).catch(() => null);

    if (existingSlab) {
      targetSlabId = existingSlab.id;
      if (!targetProjectId) targetProjectId = existingSlab.projectId;
    } else {
      if (!targetProjectId) targetProjectId = String(slabId);
      const firstSlab = await prisma.slab.findFirst({
        where: { projectId: targetProjectId },
        select: { id: true }
      }).catch(() => null);
      targetSlabId = firstSlab?.id || targetProjectId;
    }

    const user = req.user;
    const senderRole = user?.role || 'employee';
    const isSenderAdmin = senderRole === 'admin' || senderRole === 'manager';

    const newMsg = await prisma.productMessage.create({
      data: {
        slabId: targetSlabId,
        projectId: targetProjectId,
        senderId: user?.id ? String(user.id) : undefined,
        senderName: user?.name || 'Staff User',
        senderRole,
        message: message.trim(),
        attachments: Array.isArray(attachments) ? attachments : [],
        isReadByAdmin: isSenderAdmin,
        readAt: isSenderAdmin ? new Date() : null
      }
    });

    res.json({
      success: true,
      message: newMsg
    });
  } catch (error: any) {
    console.error('Error posting product message:', error);
    res.status(500).json({ message: error.message || 'Failed to post message' });
  }
});

// PATCH mark all messages in a project/slab as read (called by Admin/Manager)
router.patch('/read/:slabId', authenticate, async (req: any, res: any) => {
  try {
    const { slabId } = req.params;

    let targetProjectId = slabId;
    const slab = await prisma.slab.findUnique({
      where: { id: slabId },
      select: { projectId: true }
    }).catch(() => null);
    if (slab?.projectId) {
      targetProjectId = slab.projectId;
    }

    const result = await prisma.productMessage.updateMany({
      where: {
        OR: [
          { projectId: targetProjectId },
          { slabId }
        ],
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
  } catch (error: any) {
    console.error('Error marking product messages read:', error);
    res.status(500).json({ message: error.message || 'Failed to update read status' });
  }
});

// GET unread alerts for admin dashboard
router.get('/unread/admin-alerts', authenticate, async (req: any, res: any) => {
  try {
    const unreadMessages = await prisma.productMessage.findMany({
      where: {
        isReadByAdmin: false,
        senderRole: { not: 'admin' }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: { id: true, name: true, projectId: true, clientName: true }
        }
      }
    });

    // Group by projectId so each project has one unified chat alert
    const projectMap = new Map<string, any>();

    for (const msg of unreadMessages) {
      const pKey = msg.projectId || msg.slabId;
      if (!projectMap.has(pKey)) {
        projectMap.set(pKey, {
          slabId: pKey,
          slabName: msg.project?.name || 'Work Order Chat',
          slabSize: '',
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
      } else {
        const item = projectMap.get(pKey);
        item.unreadCount += 1;
      }
    }

    const alerts = Array.from(projectMap.values());

    res.json({
      totalUnread: unreadMessages.length,
      alertsCount: alerts.length,
      alerts
    });
  } catch (error: any) {
    console.error('Error fetching admin chat alerts:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch alerts' });
  }
});

export default router;
