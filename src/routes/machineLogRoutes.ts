import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get Machine Logs
router.get('/', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('all_machine_logs');
    if (cached) return res.json(cached);

    let logs: any[] = [];
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
        const rawLogs = await db.collection('MachineLog').find({}).sort({ createdAt: -1 }).toArray();
        const machineIds = rawLogs.map((l: any) => l.machineId).filter(Boolean);
        const projectIds = rawLogs.map((l: any) => l.projectId).filter(Boolean);
        const operatorIds = rawLogs.map((l: any) => l.operatorId).filter(Boolean);

        const [rawMachines, rawProjects, rawUsers] = await Promise.all([
          db.collection('Machine').find({ _id: { $in: machineIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray(),
          db.collection('Project').find({ _id: { $in: projectIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray(),
          db.collection('User').find({ _id: { $in: operatorIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray()
        ]);

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), { id: m._id.toString(), name: m.name, type: m.type }));

        const projectMap = new Map();
        rawProjects.forEach((p: any) => projectMap.set(p._id.toString(), { id: p._id.toString(), name: p.name, projectId: p.projectId, clientName: p.clientName }));

        const userMap = new Map();
        rawUsers.forEach((u: any) => userMap.set(u._id.toString(), { id: u._id.toString(), name: u.name, staffId: u.staffId }));

        logs = rawLogs.map((l: any) => ({
          id: l._id.toString(),
          machineId: l.machineId ? l.machineId.toString() : null,
          projectId: l.projectId ? l.projectId.toString() : null,
          productId: l.productId ? l.productId.toString() : null,
          productName: l.productName,
          startTime: l.startTime,
          endTime: l.endTime,
          estimatedHours: l.estimatedHours,
          downtime: l.downtime,
          quantityProduced: l.quantityProduced,
          operatorId: l.operatorId ? l.operatorId.toString() : null,
          machinePhotoUrl: l.machinePhotoUrl,
          unitPhotoUrl: l.unitPhotoUrl,
          softwarePhotoUrl: l.softwarePhotoUrl,
          endMachinePhotoUrl: l.endMachinePhotoUrl,
          endUnitPhotoUrl: l.endUnitPhotoUrl,
          endSoftwarePhotoUrl: l.endSoftwarePhotoUrl,
          status: l.status,
          approvalStatus: l.approvalStatus,
          isCarryForward: l.isCarryForward,
          parentLogId: l.parentLogId ? l.parentLogId.toString() : null,
          remarks: l.remarks,
          createdAt: l.createdAt,
          machine: l.machineId ? machineMap.get(l.machineId.toString()) : null,
          project: l.projectId ? projectMap.get(l.projectId.toString()) : null,
          operator: l.operatorId ? userMap.get(l.operatorId.toString()) : null
        }));

        fastCache.set('all_machine_logs', logs, 15);
        return res.json(logs);
      } catch (err) {
        console.warn('Mongoose machine log query failed, falling back to Prisma:', err);
      }
    }

    if (logs.length === 0) {
      logs = await prisma.machineLog.findMany({
        orderBy: { createdAt: 'desc' },
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
          machine: { select: { id: true, name: true, type: true } },
          project: { select: { id: true, name: true, projectId: true, clientName: true } },
          operator: { select: { id: true, name: true, staffId: true } }
        }
      });
    }

    fastCache.set('all_machine_logs', logs, 120);
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching machine logs' });
  }
});

// Live Feed Endpoint
router.get('/live-feed', authenticate, async (req, res) => {
  try {
    const activeLogs = await prisma.machineLog.findMany({
      where: { status: 'active' },
      orderBy: { startTime: 'desc' },
      include: {
        machine: { select: { name: true, type: true } },
        project: { select: { name: true, projectId: true, requirements: true } },
        operator: { select: { name: true, staffId: true } }
      }
    });
    res.json(activeLogs);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error fetching live feed' });
  }
});

// Create Machine Log
router.post('/', authenticate, async (req, res) => {
  try {
    const { machineId, projectId, startTime, downtime, remarks } = req.body;
    const operatorId = (req as any).user?.id;
    
    const newLog = await prisma.machineLog.create({
      data: {
        machineId,
        projectId: projectId || null,
        startTime: new Date(startTime),
        downtime: Number(downtime || 0),
        remarks,
        operatorId
      }
    });
    
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.status(201).json(newLog);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error creating machine log' });
  }
});

// Machine Clock-In (One-Step workflow for worker)
router.post('/clock-in', authenticate, async (req, res) => {
  try {
    const { machineId, machinePhotoUrl, unitPhotoUrl, softwarePhotoUrl, remarks, projectId, productId, productName, estimatedHours } = req.body;
    const operatorId = (req as any).user?.id;

    const newLog = await prisma.machineLog.create({
      data: {
        machineId,
        startTime: new Date(),
        estimatedHours: estimatedHours ? Number(estimatedHours) : null,
        machinePhotoUrl,
        unitPhotoUrl,
        softwarePhotoUrl,
        remarks,
        operatorId,
        projectId,
        productId,
        productName,
        status: 'active',
        approvalStatus: 'in_progress'
      }
    });
    
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.status(201).json(newLog);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error during machine clock-in' });
  }
});

// Get ALL Machine Logs for Today
router.get('/daily-logs', authenticate, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const rawLogs = await db.collection('MachineLog').find({
          $or: [
            { startTime: { $gte: startOfDay } },
            { status: 'active' }
          ]
        }).sort({ startTime: -1 }).toArray();

        const machineIds = Array.from(new Set(rawLogs.map((l: any) => l.machineId).filter(Boolean)));
        const projectIds = Array.from(new Set(rawLogs.map((l: any) => l.projectId).filter(Boolean)));
        const operatorIds = Array.from(new Set(rawLogs.map((l: any) => l.operatorId).filter(Boolean)));

        const machineObjIds = machineIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id));
        const projectObjIds = projectIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id));
        const operatorObjIds = operatorIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id));

        const [rawMachines, rawProjects, rawUsers] = await Promise.all([
          db.collection('Machine').find({ $or: [{ _id: { $in: machineObjIds } }, { id: { $in: machineIds } }] }, { projection: { name: 1 } }).toArray(),
          db.collection('Project').find({ $or: [{ _id: { $in: projectObjIds } }, { id: { $in: projectIds } }] }, { projection: { name: 1, projectId: 1, clientName: 1 } }).toArray(),
          db.collection('User').find({ $or: [{ _id: { $in: operatorObjIds } }, { id: { $in: operatorIds } }] }, { projection: { name: 1, staffId: 1 } }).toArray()
        ]);

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), { name: m.name }));

        const projectMap = new Map();
        rawProjects.forEach((p: any) => projectMap.set(p._id.toString(), { name: p.name, projectId: p.projectId, clientName: p.clientName }));

        const userMap = new Map();
        rawUsers.forEach((u: any) => userMap.set(u._id.toString(), { name: u.name, staffId: u.staffId }));

        const enrichedLogs = rawLogs.map((l: any) => ({
          ...l,
          id: l._id.toString(),
          machineId: l.machineId ? l.machineId.toString() : null,
          projectId: l.projectId ? l.projectId.toString() : null,
          operatorId: l.operatorId ? l.operatorId.toString() : null,
          machine: l.machineId ? machineMap.get(l.machineId.toString()) : null,
          project: l.projectId ? projectMap.get(l.projectId.toString()) : null,
          operator: l.operatorId ? userMap.get(l.operatorId.toString()) : null
        }));

        return res.json(enrichedLogs);
      } catch (mErr) {
        console.warn('Mongoose daily machine logs query failed, falling back to Prisma:', mErr);
      }
    }

    const dailyLogs = await prisma.machineLog.findMany({
      where: { 
        OR: [
          { startTime: { gte: startOfDay } },
          { status: 'active' }
        ]
      },
      orderBy: { startTime: 'desc' },
      include: {
        machine: { select: { name: true } },
        project: { select: { name: true, projectId: true, clientName: true } },
        operator: { select: { name: true, staffId: true } }
      }
    });
    res.json(dailyLogs);
  } catch (error) { 
    console.error(error);
    res.status(500).json({ message: 'Server error fetching daily machine logs' });
  }
});

// Machine Clock-Out (Any user can end an active log)
router.post('/clock-out', authenticate, async (req, res) => {
  try {
    const { logId, remarks, endMachinePhotoUrl, endUnitPhotoUrl, endSoftwarePhotoUrl, quantityProduced } = req.body;
    
    let log = await prisma.machineLog.findFirst({
      where: { id: logId, status: 'active' }
    });

    if (!log) {
      // If the log was split, find the machine's current active log
      const originalLog = await prisma.machineLog.findUnique({
        where: { id: logId }
      });
      if (originalLog) {
        log = await prisma.machineLog.findFirst({
          where: { machineId: originalLog.machineId, status: 'active' }
        });
      }
    }
    
    if (!log) return res.status(404).json({ message: 'Active machine log not found' });
    
    const endTime = new Date();
    const hours = (endTime.getTime() - log.startTime.getTime()) / (1000 * 60 * 60);
    
    const updatedLog = await prisma.machineLog.update({
      where: { id: log.id },
      data: {
        endTime: endTime,
        status: 'completed',
        approvalStatus: 'pending',
        remarks: remarks ? `${log.remarks || ''}\nOut: ${remarks}`.trim() : log.remarks,
        endMachinePhotoUrl,
        endUnitPhotoUrl,
        endSoftwarePhotoUrl,
        quantityProduced: quantityProduced ? parseFloat(quantityProduced) : 1
      }
    });
    
    await prisma.machine.update({
      where: { id: log.machineId },
      data: { totalRunHours: { increment: hours } }
    });

    // Also create a production log so it goes to the Admin Approvals tab
    await prisma.productionLog.create({
      data: {
        projectId: log.projectId,
        productId: log.productId,
        productName: log.productName,
        machineId: log.machineId,
        stage: 'Production Work',
        quantityProduced: quantityProduced ? parseFloat(quantityProduced) : 1,
        transactionType: 'IN',
        startPhotos: {
          machine: endMachinePhotoUrl,
          unit: endUnitPhotoUrl,
          software: endSoftwarePhotoUrl
        },
        workerId: log.operatorId,
        parentLogId: log.id,
        approvalStatus: 'pending',
        status: 'completed',
        remarks: remarks || log.remarks || undefined
      }
    });
    
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.json(updatedLog);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error during machine clock-out' });
  }
});

// Admin: Approve Log
router.put('/approve/:id', authenticate, async (req, res) => {
  try {
    const { projectId, productId, productName } = req.body;
    const updated = await prisma.machineLog.update({
      where: { id: req.params.id as string },
      data: { approvalStatus: 'approved', projectId, productId, productName }
    });
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.json(updated);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error approving log' });
  }
});

// Admin: Reject Log
router.put('/reject/:id', authenticate, async (req, res) => {
  try {
    const updated = await prisma.machineLog.update({
      where: { id: req.params.id as string },
      data: { approvalStatus: 'rejected', status: 'completed', endTime: new Date() }
    });
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.json(updated);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error rejecting log' });
  }
});

// Admin: Edit Log
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { quantityProduced, remarks, projectId, productId, productName } = req.body;
    const updated = await prisma.machineLog.update({
      where: { id: req.params.id as string },
      data: {
        quantityProduced: quantityProduced ? Number(quantityProduced) : undefined,
        remarks: remarks !== undefined ? String(remarks) : undefined,
        projectId: projectId ? String(projectId) : undefined,
        productId: productId ? String(productId) : undefined,
        productName: productName ? String(productName) : undefined
      }
    });
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.json(updated);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error editing log' });
  }
});

// Admin: Delete Log
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await prisma.machineLog.delete({
      where: { id: req.params.id as string }
    });
    fastCache.invalidate('all_machine_logs');
    fastCache.invalidate('live_feed');
    res.json({ message: 'Machine log deleted successfully' });
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error deleting log' });
  }
});

export default router;
