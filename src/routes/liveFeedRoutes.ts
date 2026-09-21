import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get live factory feed (Machine Logs for Selected Date) - Optimized with fast in-memory cache
router.get('/', authenticate, async (req, res) => {
  try {
    const dateParam = (req.query.date as string) || '';
    const cacheKey = `live_feed_${dateParam}`;
    const cached = fastCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let startOfDay: Date;
    let endOfDay: Date;

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const parts = dateParam.split('-').map(Number);
      const y = parts[0] || 2026;
      const m = parts[1] || 1;
      const d = parts[2] || 1;
      startOfDay = new Date(y, m - 1, d, 0, 0, 0, 0);
      endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      const now = new Date();
      startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    const dateWhere = {
      startTime: { lte: endOfDay },
      OR: [
        { endTime: { gte: startOfDay } },
        { endTime: null },
        { status: 'active' }
      ]
    };

    let liveFeedLogs: any[] = [];
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (!db || mongoose.connection.readyState !== 1) {
      try {
        const directUri = process.env.DATABASE_URL || 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?ssl=true&replicaSet=atlas-icn4hi-shard-0&authSource=admin&retryWrites=true&w=majority&readPreference=primaryPreferred';
        const conn = await mongoose.createConnection(directUri, { serverSelectionTimeoutMS: 3000 }).asPromise();
        db = conn.db;
      } catch (err) {
        console.warn('Could not establish dedicated Mongoose connection:', err);
      }
    }

    if (db) {
      try {
        const mongoDateWhere = {
          startTime: { $lte: endOfDay },
          $or: [
            { endTime: { $gte: startOfDay } },
            { endTime: null },
            { status: 'active' }
          ]
        };

        const rawLogs = await db.collection('MachineLog').find(mongoDateWhere).sort({ startTime: -1 }).toArray();
        const machineIds = rawLogs.map((l: any) => l.machineId).filter(Boolean);
        const projectIds = rawLogs.map((l: any) => l.projectId).filter(Boolean);
        const operatorIds = rawLogs.map((l: any) => l.operatorId).filter(Boolean);

        const [rawMachines, rawProjects, rawUsers] = await Promise.all([
          db.collection('Machine').find({ _id: { $in: machineIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray(),
          db.collection('Project').find({ _id: { $in: projectIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray(),
          db.collection('User').find({ _id: { $in: operatorIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray()
        ]);

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), { id: m._id.toString(), name: m.name, type: m.type, status: m.status }));

        const projectMap = new Map();
        rawProjects.forEach((p: any) => projectMap.set(p._id.toString(), { id: p._id.toString(), name: p.name, projectId: p.projectId, clientName: p.clientName }));

        const userMap = new Map();
        rawUsers.forEach((u: any) => userMap.set(u._id.toString(), { id: u._id.toString(), name: u.name, staffId: u.staffId, role: u.role, department: u.department }));

        liveFeedLogs = rawLogs.map((l: any) => ({
          id: l._id.toString(),
          machineId: l.machineId,
          projectId: l.projectId,
          productId: l.productId,
          productName: l.productName,
          startTime: l.startTime,
          endTime: l.endTime,
          estimatedHours: l.estimatedHours,
          downtime: l.downtime,
          quantityProduced: l.quantityProduced,
          operatorId: l.operatorId,
          machinePhotoUrl: l.machinePhotoUrl,
          unitPhotoUrl: l.unitPhotoUrl,
          softwarePhotoUrl: l.softwarePhotoUrl,
          endMachinePhotoUrl: l.endMachinePhotoUrl,
          endUnitPhotoUrl: l.endUnitPhotoUrl,
          endSoftwarePhotoUrl: l.endSoftwarePhotoUrl,
          status: l.status,
          approvalStatus: l.approvalStatus,
          isCarryForward: l.isCarryForward,
          parentLogId: l.parentLogId,
          remarks: l.remarks,
          createdAt: l.createdAt,
          machine: l.machineId ? machineMap.get(l.machineId.toString()) : null,
          project: l.projectId ? projectMap.get(l.projectId.toString()) : null,
          operator: l.operatorId ? userMap.get(l.operatorId.toString()) : null
        }));
      } catch (err) {
        console.warn('Mongoose live feed query failed, falling back to Prisma:', err);
      }
    }

    if (liveFeedLogs.length === 0) {
      liveFeedLogs = await prisma.machineLog.findMany({
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
          isCarryForward: true,
          parentLogId: true,
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
        orderBy: { startTime: 'desc' }
      });
    }

    // Batch lookup root parent logs to resolve true original First ON date & operator
    const parentIds = Array.from(new Set(liveFeedLogs.map((l: any) => l.parentLogId).filter(Boolean)));
    const rootParentsMap = new Map<string, any>();
    
    if (parentIds.length > 0) {
      const parentLogs = await prisma.machineLog.findMany({
        where: { id: { in: parentIds as string[] } },
        select: {
          id: true,
          startTime: true,
          parentLogId: true,
          operator: { select: { id: true, name: true, staffId: true } }
        }
      });
      parentLogs.forEach((p: any) => rootParentsMap.set(p.id, p));
    }

    const enrichedLogs = liveFeedLogs.map((log: any) => {
      let rootParent = log.parentLogId ? rootParentsMap.get(log.parentLogId) : null;
      // If rootParent itself had a parent, look up or fallback
      const initialStartTime = rootParent?.startTime || log.startTime;
      const initialOperator = rootParent?.operator || log.operator;

      return {
        ...log,
        initialStartTime,
        initialOperator
      };
    });

    fastCache.set(cacheKey, enrichedLogs, 6);
    res.json(enrichedLogs);
  } catch (error) {
    console.error('Live Feed Error:', error);
    res.status(500).json({ message: 'Server error fetching live feed' });
  }
});

export default router;
