import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get live factory feed (Machine Logs for Selected Date) - Optimized with fast in-memory cache
router.get('/', authenticate, async (req, res) => {
  try {
    const dateParam = (req.query.date as string) || '';

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    let startOfDay: Date;
    let endOfDay: Date;

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const parts = dateParam.split('-').map(Number);
      const y = parts[0] || 2026;
      const m = parts[1] || 1;
      const d = parts[2] || 1;
      startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - IST_OFFSET_MS);
      endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MS);
    } else {
      const now = new Date();
      const istNow = new Date(now.getTime() + IST_OFFSET_MS);
      const y = istNow.getUTCFullYear();
      const m = istNow.getUTCMonth();
      const d = istNow.getUTCDate();
      startOfDay = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS);
      endOfDay = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MS);
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

        // Recursive lookup for root parent logs to find TRUE original start time
        let currentParentIds: string[] = Array.from(new Set(rawLogs.map((l: any) => l.parentLogId?.toString()).filter(Boolean) as string[]));
        const allParentsMap = new Map<string, any>();
        let hops = 0;
        while (currentParentIds.length > 0 && hops++ < 10) {
          const missingIds: string[] = currentParentIds.filter((id: string) => !allParentsMap.has(id));
          if (missingIds.length === 0) break;
          const parentObjIds = missingIds.filter((pId: any) => mongoose.Types.ObjectId.isValid(pId)).map((pId: any) => new mongoose.Types.ObjectId(pId));
          const parentDocs = await db.collection('MachineLog').find({
            $or: [
              { _id: { $in: parentObjIds } },
              { id: { $in: missingIds } }
            ]
          }, { projection: { startTime: 1, parentLogId: 1, operatorId: 1, machineId: 1 } }).toArray();
          if (parentDocs.length === 0) break;
          const nextParentIds: string[] = [];
          for (const doc of parentDocs) {
            allParentsMap.set(doc._id.toString(), doc);
            if (doc.parentLogId) nextParentIds.push(doc.parentLogId.toString());
          }
          currentParentIds = nextParentIds;
        }

        // Fetch any missing operators for root parents
        const extraOpIds = Array.from(allParentsMap.values()).map(p => p.operatorId).filter(Boolean);
        if (extraOpIds.length > 0) {
          const extraUsers = await db.collection('User').find({
            _id: { $in: extraOpIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) }
          }).toArray();
          extraUsers.forEach((u: any) => {
            if (!userMap.has(u._id.toString())) {
              userMap.set(u._id.toString(), { id: u._id.toString(), name: u.name, staffId: u.staffId, role: u.role, department: u.department });
            }
          });
        }

        const enrichedLogs = rawLogs.map((l: any) => {
          const id = l._id.toString();
          const mId = l.machineId ? l.machineId.toString() : null;
          const pId = l.projectId ? l.projectId.toString() : null;
          const opId = l.operatorId ? l.operatorId.toString() : null;

          // Recursively traverse to find root parent
          let rootLog = l;
          let currentParentId = l.parentLogId?.toString();
          const visited = new Set<string>();
          while (currentParentId && allParentsMap.has(currentParentId) && !visited.has(currentParentId)) {
            visited.add(currentParentId);
            const parent = allParentsMap.get(currentParentId);
            rootLog = parent;
            currentParentId = parent.parentLogId?.toString();
          }

          const operator = opId ? userMap.get(opId) : null;
          const rootOperatorId = rootLog.operatorId ? rootLog.operatorId.toString() : null;
          const initialOperator = rootOperatorId ? (userMap.get(rootOperatorId) || operator) : operator;

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
            isCarryForward: Boolean(l.isCarryForward),
            parentLogId: l.parentLogId ? l.parentLogId.toString() : null,
            remarks: l.remarks,
            createdAt: l.createdAt,
            machine: mId ? machineMap.get(mId) : null,
            project: pId ? projectMap.get(pId) : null,
            operator,
            initialStartTime: rootLog?.startTime || l.startTime,
            initialOperator
          };
        });

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

    const parentIds = Array.from(new Set(prismaLogs.map((l: any) => l.parentLogId).filter(Boolean))) as string[];
    const prismaParentsMap = new Map<string, any>();
    if (parentIds.length > 0) {
      const parents = await prisma.machineLog.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, startTime: true, parentLogId: true, operator: { select: { id: true, name: true, staffId: true } } }
      });
      parents.forEach((p: any) => prismaParentsMap.set(p.id, p));
    }

    const enrichedPrismaLogs = prismaLogs.map((l: any) => {
      const root = l.parentLogId ? prismaParentsMap.get(l.parentLogId) : null;
      return {
        ...l,
        isCarryForward: Boolean(l.isCarryForward),
        initialStartTime: root?.startTime || l.startTime,
        initialOperator: root?.operator || l.operator
      };
    });

    res.json(enrichedPrismaLogs);
  } catch (error) {
    console.error('Live Feed Error:', error);
    res.status(500).json({ message: 'Server error fetching live feed' });
  }
});

export default router;

