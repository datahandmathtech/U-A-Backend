import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { autoSplitActiveMachineLogs } from '../utils/machineLogHelper';

const router = Router();

// Get live factory feed (Machine Logs for Selected Date) - Optimized for high performance
router.get('/', authenticate, async (req, res) => {
  try {
    // Run midnight auto-split asynchronously in background so GET request responds instantly
    autoSplitActiveMachineLogs().catch(err => console.error('[LiveFeed] Background autoSplit error:', err));

    const dateParam = req.query.date as string;
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

    const liveFeedLogs = await prisma.machineLog.findMany({
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

    res.json(enrichedLogs);
  } catch (error) {
    console.error('Live Feed Error:', error);
    res.status(500).json({ message: 'Server error fetching live feed' });
  }
});

export default router;
