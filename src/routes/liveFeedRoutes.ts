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

        // Batch lookup root parent logs with Mongoose for true original start time
        const parentIds = Array.from(new Set(rawLogs.map((l: any) => l.parentLogId).filter(Boolean)));
        const rootParentsMap = new Map();
        if (parentIds.length > 0) {
          const parentObjIds = parentIds.filter((pId: any) => mongoose.Types.ObjectId.isValid(pId)).map((pId: any) => new mongoose.Types.ObjectId(pId));
          const parentDocs = await db.collection('MachineLog').find({
            $or: [
              { _id: { $in: parentObjIds } },
              { id: { $in: parentIds } }
            ]
          }, { projection: { startTime: 1, parentLogId: 1, operatorId: 1 } }).toArray();
          
          parentDocs.forEach((p: any) => {
            const op = p.operatorId ? userMap.get(p.operatorId.toString()) : null;
            rootParentsMap.set(p._id.toString(), {
              id: p._id.toString(),
              startTime: p.startTime,
              parentLogId: p.parentLogId,
              operator: op
            });
          });
        }

        const enrichedLogs = rawLogs.map((l: any) => {
          const id = l._id.toString();
          const mId = l.machineId ? l.machineId.toString() : null;
          const pId = l.projectId ? l.projectId.toString() : null;
          const opId = l.operatorId ? l.operatorId.toString() : null;
          const parentId = l.parentLogId ? l.parentLogId.toString() : null;
          const rootParent = parentId ? rootParentsMap.get(parentId) : null;
          const operator = opId ? userMap.get(opId) : null;

          return {
            id,
            machineId: mId,
            projectId: pId,
            productId: l.productId ? l.productId.toString() : null,
            productName: l.productName,
            startTime: l.startTime,
            endTime: l.endTime,
            estimatedHours: l.estimatedHours,
            downtime: l.downtime,
            quantityProduced: l.quantityProduced,
            operatorId: opId,
            machinePhotoUrl: l.machinePhotoUrl,
            unitPhotoUrl: l.unitPhotoUrl,
            softwarePhotoUrl: l.softwarePhotoUrl,
            endMachinePhotoUrl: l.endMachinePhotoUrl,
            endUnitPhotoUrl: l.endUnitPhotoUrl,
            endSoftwarePhotoUrl: l.endSoftwarePhotoUrl,
            status: l.status,
            approvalStatus: l.approvalStatus,
            isCarryForward: l.isCarryForward,
            parentLogId: parentId,
            remarks: l.remarks,
            createdAt: l.createdAt,
            machine: mId ? machineMap.get(mId) : null,
            project: pId ? projectMap.get(pId) : null,
            operator,
            initialStartTime: rootParent?.startTime || l.startTime,
            initialOperator: rootParent?.operator || operator
          };
        });

        fastCache.set(cacheKey, enrichedLogs, 15);
        return res.json(enrichedLogs);
      } catch (err) {
        console.warn('Mongoose live feed query failed, falling back to Prisma:', err);
      }
    }

    // Prisma Fallback
    const prismaLogs = await prisma.machineLog.findMany({
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

    fastCache.set(cacheKey, prismaLogs, 10);
    res.json(prismaLogs);
  } catch (error) {
    console.error('Live Feed Error:', error);
    res.status(500).json({ message: 'Server error fetching live feed' });
  }
});

export default router;
