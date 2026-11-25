"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const index_1 = require("../index");
const auth_1 = require("../middleware/auth");
const fastCache_1 = require("../utils/fastCache");
const dashboardChatHelpers_1 = require("../utils/dashboardChatHelpers");
const router = express_1.default.Router();
const toIdCandidates = (id) => {
    const candidates = [String(id)];
    if (mongoose_1.default.Types.ObjectId.isValid(id)) {
        candidates.push(new mongoose_1.default.Types.ObjectId(id));
    }
    return candidates;
};
const normalizeMessage = (m) => ({
    id: m._id ? m._id.toString() : String(m.id),
    slabId: m.slabId ? m.slabId.toString() : '',
    projectId: m.projectId ? m.projectId.toString() : '',
    senderId: m.senderId ? m.senderId.toString() : null,
    senderName: m.senderName || 'Staff User',
    senderRole: m.senderRole || 'employee',
    message: m.message || '',
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    isReadByAdmin: Boolean(m.isReadByAdmin),
    readAt: m.readAt || null,
    readBy: (0, dashboardChatHelpers_1.normalizeReadBy)(m.readBy),
    createdAt: m.createdAt || new Date(),
    updatedAt: m.updatedAt || m.createdAt || new Date()
});
const resolveViewer = async (req, db) => {
    const userId = String(req.user?.id || req.user?.userId || '');
    const fallbackRole = String(req.user?.role || 'employee');
    const cached = userId ? fastCache_1.fastCache.get(`chat_user_${userId}`) : null;
    if (cached)
        return cached;
    let userName = req.user?.name || '';
    let userRole = fallbackRole;
    if (userId) {
        try {
            if (db && mongoose_1.default.Types.ObjectId.isValid(userId)) {
                const u = await db.collection('User').findOne({ _id: new mongoose_1.default.Types.ObjectId(userId) }, { projection: { name: 1, role: 1 } });
                if (u?.name)
                    userName = u.name;
                if (u?.role)
                    userRole = u.role;
            }
            else {
                const u = await index_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { name: true, role: true }
                });
                if (u?.name)
                    userName = u.name;
                if (u?.role)
                    userRole = u.role;
            }
        }
        catch {
            // Fall back to JWT payload / body hints if DB lookup fails
        }
    }
    const resolved = {
        userId,
        userName: userName || req.body?.senderName || (userRole === 'admin' ? 'Admin User' : 'Staff User'),
        userRole
    };
    if (userId) {
        fastCache_1.fastCache.set(`chat_user_${userId}`, resolved, 300);
    }
    return resolved;
};
const getActiveProjectMap = async (db) => {
    const activeMap = new Map();
    const firstSlabMap = new Map();
    const closedIds = new Set();
    const activeStatusesArray = Array.from(dashboardChatHelpers_1.ACTIVE_CHAT_PROJECT_STATUSES);
    if (db) {
        const [rawProjects, rawClosures, rawSlabs, rawPieces, rawLogs] = await Promise.all([
            db.collection('Project')
                .find({ status: { $in: activeStatusesArray }, hasChatRoom: { $ne: false } }, {
                projection: {
                    projectId: 1,
                    name: 1,
                    clientName: 1,
                    status: 1,
                    customerPhoto: 1,
                    hasChatRoom: 1,
                    progressPercentage: 1,
                    createdAt: 1,
                    updatedAt: 1
                }
            })
                .sort({ updatedAt: -1 })
                .toArray(),
            db.collection('ProjectClosure').find({}, { projection: { projectId: 1, status: 1 } }).toArray(),
            db.collection('Slab').find({}, { projection: { projectId: 1, status: 1, requiredStages: 1 } }).toArray(),
            db.collection('Piece').find({}, { projection: { slabId: 1, stage: 1, status: 1 } }).toArray(),
            db.collection('PieceLog').find({}, { projection: { pieceId: 1, stage: 1, status: 1 } }).toArray()
        ]);
        for (const c of rawClosures) {
            if (c.projectId && (!c.status || c.status === 'closed')) {
                closedIds.add(c.projectId.toString());
            }
        }
        const slabsByProject = new Map();
        for (const s of rawSlabs) {
            const pId = s.projectId ? s.projectId.toString() : '';
            if (!pId)
                continue;
            if (!firstSlabMap.has(pId)) {
                firstSlabMap.set(pId, s._id.toString());
            }
            if (!slabsByProject.has(pId))
                slabsByProject.set(pId, []);
            slabsByProject.get(pId).push(s);
        }
        const piecesBySlab = new Map();
        for (const pc of rawPieces) {
            const sId = pc.slabId ? pc.slabId.toString() : '';
            if (!sId)
                continue;
            if (!piecesBySlab.has(sId))
                piecesBySlab.set(sId, []);
            piecesBySlab.get(sId).push(pc);
        }
        const logsByPiece = new Map();
        for (const lg of rawLogs) {
            const pcId = lg.pieceId ? lg.pieceId.toString() : '';
            if (!pcId)
                continue;
            if (!logsByPiece.has(pcId))
                logsByPiece.set(pcId, []);
            logsByPiece.get(pcId).push(lg);
        }
        for (const p of rawProjects) {
            const pId = p._id.toString();
            const projSlabs = slabsByProject.get(pId) || [];
            if ((0, dashboardChatHelpers_1.isProjectCompletedForChat)(p, closedIds, projSlabs, piecesBySlab, logsByPiece)) {
                continue;
            }
            activeMap.set(pId, {
                id: pId,
                projectId: p.projectId || '',
                name: p.name || 'Work Order',
                clientName: p.clientName || p.name || 'Client Room',
                status: p.status || 'production',
                customerPhoto: p.customerPhoto || '',
                firstSlabId: firstSlabMap.get(pId) || pId,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
            });
        }
        return activeMap;
    }
    const projects = await index_1.prisma.project.findMany({
        where: {
            status: { in: activeStatusesArray }
        },
        select: {
            id: true,
            projectId: true,
            name: true,
            clientName: true,
            status: true,
            customerPhoto: true,
            hasChatRoom: true,
            progressPercentage: true,
            createdAt: true,
            updatedAt: true,
            projectClosure: { select: { id: true, status: true } },
            slabs: {
                select: {
                    id: true,
                    status: true,
                    requiredStages: true,
                    pieces: {
                        select: {
                            id: true,
                            stage: true,
                            status: true,
                            logs: {
                                select: {
                                    stage: true,
                                    status: true
                                }
                            }
                        }
                    }
                }
            }
        },
        orderBy: { updatedAt: 'desc' }
    });
    for (const p of projects) {
        if (p.projectClosure && (!p.projectClosure.status || p.projectClosure.status === 'closed')) {
            closedIds.add(p.id);
        }
        if ((0, dashboardChatHelpers_1.isProjectCompletedForChat)(p, closedIds, p.slabs || []))
            continue;
        activeMap.set(p.id, {
            id: p.id,
            projectId: p.projectId || '',
            name: p.name || 'Work Order',
            clientName: p.clientName || p.name || 'Client Room',
            status: p.status || 'production',
            customerPhoto: p.customerPhoto || '',
            firstSlabId: p.slabs?.[0]?.id || p.id,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
        });
    }
    return activeMap;
};
const resolveProjectContext = async (slabOrProjectId, providedProjectId, db) => {
    let targetProjectId = providedProjectId ? String(providedProjectId) : '';
    let targetSlabId = String(slabOrProjectId);
    if (db && mongoose_1.default.Types.ObjectId.isValid(slabOrProjectId)) {
        const slab = await db.collection('Slab').findOne({ _id: new mongoose_1.default.Types.ObjectId(slabOrProjectId) }, { projection: { projectId: 1 } });
        if (slab?.projectId) {
            targetProjectId = slab.projectId.toString();
        }
        else if (!targetProjectId) {
            targetProjectId = slabOrProjectId;
            const firstSlab = await db.collection('Slab').findOne({ projectId: { $in: toIdCandidates(targetProjectId) } }, { projection: { _id: 1 } });
            if (firstSlab?._id)
                targetSlabId = firstSlab._id.toString();
        }
    }
    else {
        const existingSlab = await index_1.prisma.slab.findUnique({
            where: { id: String(slabOrProjectId) },
            select: { id: true, projectId: true }
        }).catch(() => null);
        if (existingSlab) {
            targetSlabId = existingSlab.id;
            if (!targetProjectId)
                targetProjectId = existingSlab.projectId;
        }
        else {
            if (!targetProjectId)
                targetProjectId = String(slabOrProjectId);
            const firstSlab = await index_1.prisma.slab.findFirst({
                where: { projectId: targetProjectId },
                select: { id: true }
            }).catch(() => null);
            targetSlabId = firstSlab?.id || targetProjectId;
        }
    }
    return { targetProjectId, targetSlabId };
};
// GET all active chat rooms with latest message preview and per-user unread count (completed orders excluded)
router.get('/rooms/summary', auth_1.authenticate, async (req, res) => {
    try {
        const db = mongoose_1.default.connection?.db;
        const viewer = await resolveViewer(req, db);
        const activeProjectMap = await getActiveProjectMap(db);
        const activeProjectIds = Array.from(activeProjectMap.keys());
        if (activeProjectIds.length === 0) {
            return res.json({ totalUnread: 0, roomsCount: 0, rooms: [] });
        }
        let messages = [];
        if (db) {
            const candidateIds = activeProjectIds.flatMap((id) => toIdCandidates(id));
            const rawMsgs = await db.collection('ProductMessage')
                .find({ projectId: { $in: candidateIds } })
                .sort({ createdAt: 1 })
                .toArray();
            messages = rawMsgs.map(normalizeMessage);
        }
        else {
            const rawMsgs = await index_1.prisma.productMessage.findMany({
                where: { projectId: { in: activeProjectIds } },
                orderBy: { createdAt: 'asc' }
            });
            messages = rawMsgs.map(normalizeMessage);
        }
        const statsMap = new Map();
        let totalUnread = 0;
        for (const msg of messages) {
            const pId = msg.projectId;
            if (!activeProjectMap.has(pId))
                continue;
            let entry = statsMap.get(pId);
            if (!entry) {
                entry = { unreadCount: 0, totalMessages: 0, lastMsg: null };
                statsMap.set(pId, entry);
            }
            entry.totalMessages += 1;
            entry.lastMsg = msg;
            if ((0, dashboardChatHelpers_1.isMessageUnreadForViewer)(msg, viewer.userId, viewer.userRole)) {
                entry.unreadCount += 1;
                totalUnread += 1;
            }
        }
        const rooms = activeProjectIds.map((pId) => {
            const proj = activeProjectMap.get(pId);
            const stats = statsMap.get(pId);
            const lastMsg = stats?.lastMsg || null;
            const previewText = lastMsg
                ? (lastMsg.message || (lastMsg.attachments?.length ? '📷 Photo attachment' : ''))
                : '';
            return {
                projectId: pId,
                slabId: proj.firstSlabId || pId,
                workOrderId: proj.projectId,
                projectName: proj.name,
                clientName: proj.clientName,
                status: proj.status,
                customerPhoto: proj.customerPhoto,
                lastMessage: previewText,
                lastMessageTime: lastMsg?.createdAt || null,
                lastMessageSortTime: new Date(lastMsg?.createdAt || proj.updatedAt || proj.createdAt || 0).getTime(),
                lastSenderId: lastMsg?.senderId || null,
                lastSenderName: lastMsg?.senderName || null,
                lastSenderRole: lastMsg?.senderRole || null,
                lastMessageReadBy: lastMsg?.readBy || [],
                lastMessageIsReadByAdmin: lastMsg?.isReadByAdmin || false,
                hasAttachments: Boolean(lastMsg?.attachments?.length),
                totalMessages: stats?.totalMessages || 0,
                unreadCount: stats?.unreadCount || 0
            };
        });
        // Unread rooms surface first, then sort by latest activity descending (WhatsApp style)
        rooms.sort((a, b) => {
            if ((b.unreadCount > 0 ? 1 : 0) !== (a.unreadCount > 0 ? 1 : 0)) {
                return (b.unreadCount > 0 ? 1 : 0) - (a.unreadCount > 0 ? 1 : 0);
            }
            if (Boolean(b.lastMessageTime) !== Boolean(a.lastMessageTime)) {
                return b.lastMessageTime ? 1 : -1;
            }
            return b.lastMessageSortTime - a.lastMessageSortTime;
        });
        res.json({
            totalUnread,
            roomsCount: rooms.length,
            rooms
        });
    }
    catch (error) {
        console.error('Error fetching chat rooms summary:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch chat rooms summary' });
    }
});
// GET unread alerts for the currently authenticated user across active (non-completed) rooms
router.get('/unread/admin-alerts', auth_1.authenticate, async (req, res) => {
    try {
        const db = mongoose_1.default.connection?.db;
        const viewer = await resolveViewer(req, db);
        const activeProjectMap = await getActiveProjectMap(db);
        const activeProjectIds = Array.from(activeProjectMap.keys());
        if (activeProjectIds.length === 0) {
            return res.json({ totalUnread: 0, alertsCount: 0, alerts: [] });
        }
        let messages = [];
        if (db) {
            const candidateIds = activeProjectIds.flatMap((id) => toIdCandidates(id));
            const rawMsgs = await db.collection('ProductMessage')
                .find({ projectId: { $in: candidateIds } })
                .sort({ createdAt: -1 })
                .toArray();
            messages = rawMsgs.map(normalizeMessage);
        }
        else {
            const rawMsgs = await index_1.prisma.productMessage.findMany({
                where: { projectId: { in: activeProjectIds } },
                orderBy: { createdAt: 'desc' }
            });
            messages = rawMsgs.map(normalizeMessage);
        }
        const projectAlertMap = new Map();
        let totalUnread = 0;
        for (const msg of messages) {
            const pKey = msg.projectId || msg.slabId;
            const proj = activeProjectMap.get(pKey);
            if (!proj)
                continue;
            if (!(0, dashboardChatHelpers_1.isMessageUnreadForViewer)(msg, viewer.userId, viewer.userRole))
                continue;
            totalUnread += 1;
            if (!projectAlertMap.has(pKey)) {
                projectAlertMap.set(pKey, {
                    slabId: proj.firstSlabId || pKey,
                    slabName: proj.name || 'Work Order Chat',
                    slabSize: '',
                    projectId: pKey,
                    projectName: proj.name || 'Work Order',
                    workOrderId: proj.projectId || '',
                    clientName: proj.clientName || '',
                    customerPhoto: proj.customerPhoto || '',
                    lastMessage: msg.message,
                    lastSenderId: msg.senderId,
                    lastSenderName: msg.senderName,
                    lastSenderRole: msg.senderRole,
                    lastMessageTime: msg.createdAt,
                    hasAttachments: Boolean(msg.attachments && msg.attachments.length > 0),
                    unreadCount: 1
                });
            }
            else {
                projectAlertMap.get(pKey).unreadCount += 1;
            }
        }
        const alerts = Array.from(projectAlertMap.values());
        res.json({
            totalUnread,
            alertsCount: alerts.length,
            alerts
        });
    }
    catch (error) {
        console.error('Error fetching user chat alerts:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch alerts' });
    }
});
// GET all messages for a project (or slab) - permanent history remains readable even after completion
router.get('/:slabId', auth_1.authenticate, async (req, res) => {
    try {
        const { slabId } = req.params;
        if (!slabId) {
            return res.status(400).json({ message: 'slabId is required' });
        }
        const db = mongoose_1.default.connection?.db;
        const viewer = await resolveViewer(req, db);
        const { targetProjectId } = await resolveProjectContext(slabId, undefined, db);
        let messages = [];
        if (db) {
            const projectCandidates = toIdCandidates(targetProjectId);
            const slabCandidates = toIdCandidates(slabId);
            const rawMsgs = await db.collection('ProductMessage')
                .find({
                $or: [
                    { projectId: { $in: projectCandidates } },
                    { slabId: { $in: slabCandidates } }
                ]
            })
                .sort({ createdAt: 1 })
                .toArray();
            messages = rawMsgs.map(normalizeMessage);
        }
        else {
            const rawMsgs = await index_1.prisma.productMessage.findMany({
                where: {
                    OR: [
                        { projectId: targetProjectId },
                        { slabId }
                    ]
                },
                orderBy: { createdAt: 'asc' }
            });
            messages = rawMsgs.map(normalizeMessage);
        }
        const unreadCount = messages.filter((m) => (0, dashboardChatHelpers_1.isMessageUnreadForViewer)(m, viewer.userId, viewer.userRole)).length;
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
// POST a new message for a project (or slab)
router.post('/:slabId', auth_1.authenticate, async (req, res) => {
    try {
        const { slabId } = req.params;
        const { projectId, message, attachments = [] } = req.body;
        const cleanAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
        const cleanMessage = (message || '').trim() || (cleanAttachments.length > 0 ? '📷 Photo attachment' : '');
        if (!slabId || !cleanMessage) {
            return res.status(400).json({ message: 'slabId and message or attachment are required' });
        }
        const db = mongoose_1.default.connection?.db;
        const viewer = await resolveViewer(req, db);
        const { targetProjectId, targetSlabId } = await resolveProjectContext(slabId, projectId, db);
        const isSenderAdmin = viewer.userRole === 'admin' || viewer.userRole === 'manager';
        const now = new Date();
        const initialReadBy = viewer.userId
            ? [{
                    userId: viewer.userId,
                    userName: viewer.userName,
                    userRole: viewer.userRole,
                    seenAt: now
                }]
            : [];
        const newMsg = await index_1.prisma.productMessage.create({
            data: {
                slabId: targetSlabId,
                projectId: targetProjectId,
                senderId: viewer.userId && mongoose_1.default.Types.ObjectId.isValid(viewer.userId) ? viewer.userId : undefined,
                senderName: viewer.userName,
                senderRole: viewer.userRole,
                message: cleanMessage,
                attachments: cleanAttachments,
                isReadByAdmin: isSenderAdmin,
                readAt: isSenderAdmin ? now : null,
                readBy: initialReadBy
            }
        });
        res.json({
            success: true,
            message: normalizeMessage(newMsg)
        });
    }
    catch (error) {
        console.error('Error posting product message:', error);
        res.status(500).json({ message: error.message || 'Failed to post message' });
    }
});
// PATCH mark all unread messages in a project/slab as read by the current authenticated user
router.patch('/read/:slabId', auth_1.authenticate, async (req, res) => {
    try {
        const { slabId } = req.params;
        if (!slabId) {
            return res.status(400).json({ message: 'slabId is required' });
        }
        const db = mongoose_1.default.connection?.db;
        const viewer = await resolveViewer(req, db);
        const { targetProjectId } = await resolveProjectContext(slabId, undefined, db);
        const isAdminViewer = viewer.userRole === 'admin' || viewer.userRole === 'manager';
        const now = new Date();
        let updatedCount = 0;
        if (db) {
            const projectCandidates = toIdCandidates(targetProjectId);
            const slabCandidates = toIdCandidates(slabId);
            const existingMsgs = await db.collection('ProductMessage')
                .find({
                $or: [
                    { projectId: { $in: projectCandidates } },
                    { slabId: { $in: slabCandidates } }
                ]
            }, { projection: { _id: 1, senderId: 1, isReadByAdmin: 1, readBy: 1 } })
                .toArray();
            const ops = [];
            for (const m of existingMsgs) {
                const senderId = m.senderId ? m.senderId.toString() : '';
                const readBy = (0, dashboardChatHelpers_1.normalizeReadBy)(m.readBy);
                const alreadyInReadBy = Boolean(viewer.userId && readBy.some((r) => r.userId === viewer.userId));
                const shouldAddViewer = Boolean(viewer.userId && senderId !== viewer.userId && !alreadyInReadBy);
                const shouldSetAdminRead = isAdminViewer && !m.isReadByAdmin;
                if (!shouldAddViewer && !shouldSetAdminRead)
                    continue;
                const nextReadBy = shouldAddViewer
                    ? [
                        ...readBy,
                        {
                            userId: viewer.userId,
                            userName: viewer.userName,
                            userRole: viewer.userRole,
                            seenAt: now
                        }
                    ]
                    : readBy;
                const setFields = { readBy: nextReadBy, updatedAt: now };
                if (shouldSetAdminRead) {
                    setFields.isReadByAdmin = true;
                    setFields.readAt = now;
                }
                ops.push({
                    updateOne: {
                        filter: { _id: m._id },
                        update: { $set: setFields }
                    }
                });
            }
            if (ops.length > 0) {
                await db.collection('ProductMessage').bulkWrite(ops);
                updatedCount = ops.length;
            }
        }
        else {
            const existingMsgs = await index_1.prisma.productMessage.findMany({
                where: {
                    OR: [{ projectId: targetProjectId }, { slabId }]
                }
            });
            for (const m of existingMsgs) {
                const senderId = m.senderId ? String(m.senderId) : '';
                const readBy = (0, dashboardChatHelpers_1.normalizeReadBy)(m.readBy);
                const alreadyInReadBy = Boolean(viewer.userId && readBy.some((r) => r.userId === viewer.userId));
                const shouldAddViewer = Boolean(viewer.userId && senderId !== viewer.userId && !alreadyInReadBy);
                const shouldSetAdminRead = isAdminViewer && !m.isReadByAdmin;
                if (!shouldAddViewer && !shouldSetAdminRead)
                    continue;
                const nextReadBy = shouldAddViewer
                    ? [
                        ...readBy,
                        {
                            userId: viewer.userId,
                            userName: viewer.userName,
                            userRole: viewer.userRole,
                            seenAt: now
                        }
                    ]
                    : readBy;
                await index_1.prisma.productMessage.update({
                    where: { id: m.id },
                    data: {
                        readBy: nextReadBy,
                        ...(shouldSetAdminRead ? { isReadByAdmin: true, readAt: now } : {})
                    }
                });
                updatedCount += 1;
            }
        }
        res.json({
            success: true,
            updatedCount
        });
    }
    catch (error) {
        console.error('Error marking product messages read:', error);
        res.status(500).json({ message: error.message || 'Failed to update read status' });
    }
});
exports.default = router;
//# sourceMappingURL=productChatRoutes.js.map