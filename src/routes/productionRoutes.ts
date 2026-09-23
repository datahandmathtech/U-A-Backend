import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get production logs
router.get('/', authenticate, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const rawLogs = await db.collection('ProductionLog').find({}).sort({ createdAt: -1 }).limit(1000).toArray();
        const projectIds = Array.from(new Set(rawLogs.map((l: any) => l.projectId).filter(Boolean)));
        const machineIds = Array.from(new Set(rawLogs.map((l: any) => l.machineId).filter(Boolean)));

        const projectObjIds = projectIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id));
        const machineObjIds = machineIds.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).map((id: any) => new mongoose.Types.ObjectId(id));

        const [rawProjects, rawMachines] = await Promise.all([
          db.collection('Project').find({ $or: [{ _id: { $in: projectObjIds } }, { id: { $in: projectIds } }] }, { projection: { name: 1, projectId: 1, clientName: 1 } }).toArray(),
          db.collection('Machine').find({ $or: [{ _id: { $in: machineObjIds } }, { id: { $in: machineIds } }] }, { projection: { name: 1 } }).toArray()
        ]);

        const projectMap = new Map();
        rawProjects.forEach((p: any) => projectMap.set(p._id.toString(), { name: p.name, projectId: p.projectId, clientName: p.clientName }));

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), { name: m.name }));

        const enrichedLogs = rawLogs.map((l: any) => ({
          ...l,
          id: l._id.toString(),
          projectId: l.projectId ? l.projectId.toString() : null,
          machineId: l.machineId ? l.machineId.toString() : null,
          project: l.projectId ? projectMap.get(l.projectId.toString()) : null,
          machine: l.machineId ? machineMap.get(l.machineId.toString()) : null
        }));

        return res.json(enrichedLogs);
      } catch (mErr) {
        console.warn('Mongoose production logs query failed, falling back to Prisma:', mErr);
      }
    }

    const logs = await prisma.productionLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { name: true } }, machine: { select: { name: true } } }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching production logs' });
  }
});

// Get Active Work Orders (Comprehensive List)
router.get('/work-orders', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('prod_work_orders');
    if (cached) return res.json(cached);

    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const rawProjects = await db.collection('Project').find({ status: 'work_order' }).toArray();
        const pIds = rawProjects.map((p: any) => p._id.toString());
        const pObjIds = pIds.map((id: string) => new mongoose.Types.ObjectId(id));

        const [rawMachineLogs, rawProdLogs, rawMachines] = await Promise.all([
          db.collection('MachineLog').find({ $or: [{ projectId: { $in: pIds } }, { projectId: { $in: pObjIds } }] }).toArray(),
          db.collection('ProductionLog').find({ $or: [{ projectId: { $in: pIds } }, { projectId: { $in: pObjIds } }] }).toArray(),
          db.collection('Machine').find({}, { projection: { name: 1 } }).toArray()
        ]);

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), m.name));

        const mLogsByProject = new Map();
        rawMachineLogs.forEach((ml: any) => {
          const pId = ml.projectId?.toString();
          if (!mLogsByProject.has(pId)) mLogsByProject.set(pId, []);
          mLogsByProject.get(pId).push({
            ...ml,
            machine: ml.machineId ? { name: machineMap.get(ml.machineId.toString()) || 'Machine' } : null
          });
        });

        const pLogsByProject = new Map();
        rawProdLogs.forEach((pl: any) => {
          const pId = pl.projectId?.toString();
          if (!pLogsByProject.has(pId)) pLogsByProject.set(pId, []);
          pLogsByProject.get(pId).push(pl);
        });

        const formattedWorkOrders = rawProjects.map((p: any) => {
          const pId = p._id.toString();
          const pMachineLogs = mLogsByProject.get(pId) || [];
          const pProdLogs = pLogsByProject.get(pId) || [];

          let totalUsageTimeHours = 0;
          let earliestStart = null as Date | null;
          let latestEnd = null as Date | null;
          const machinesUsed = new Set<string>();

          pMachineLogs.forEach((log: any) => {
            if (log.machine?.name) machinesUsed.add(log.machine.name);
            const start = new Date(log.startTime);
            const end = log.endTime ? new Date(log.endTime) : new Date();
            if (!earliestStart || start < earliestStart) earliestStart = start;
            if (!latestEnd || end > latestEnd) latestEnd = end;
            const diffMs = end.getTime() - start.getTime();
            totalUsageTimeHours += (diffMs / (1000 * 60 * 60));
          });

          const completedLogs = pProdLogs.filter((pl: any) => pl.status === 'completed');
          const totalLogs = pProdLogs.length;
          const statusText = totalLogs > 0 ? `${completedLogs.length}/${totalLogs} Stages Completed` : 'In Progress';

          return {
            id: pId,
            projectId: p.projectId,
            clientDemand: p.requirements || p.description || 'N/A',
            machinesUsed: Array.from(machinesUsed).join(', ') || 'N/A',
            startTime: earliestStart,
            endTime: latestEnd,
            dateRange: earliestStart && latestEnd ? `${earliestStart.toLocaleDateString()} - ${latestEnd.toLocaleDateString()}` : 'N/A',
            totalUsageTime: totalUsageTimeHours.toFixed(2) + ' hours',
            status: statusText,
            progressPercentage: p.progressPercentage || 0
          };
        });

        fastCache.set('prod_work_orders', formattedWorkOrders, 30);
        return res.json(formattedWorkOrders);
      } catch (mErr) {
        console.warn('Mongoose active work orders query failed, falling back to Prisma:', mErr);
      }
    }

    const projects = await prisma.project.findMany({
      where: { status: 'work_order' },
      select: {
        id: true,
        projectId: true,
        requirements: true,
        description: true,
        progressPercentage: true,
        machineLogs: {
          select: {
            startTime: true,
            endTime: true,
            machine: { select: { name: true } }
          }
        },
        productionLogs: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    const formattedWorkOrders = projects.map(p => {
      let totalUsageTimeHours = 0;
      let earliestStart = null as Date | null;
      let latestEnd = null as Date | null;
      const machinesUsed = new Set<string>();

      p.machineLogs.forEach(log => {
        if (log.machine) machinesUsed.add(log.machine.name);
        
        const start = new Date(log.startTime);
        const end = log.endTime ? new Date(log.endTime) : new Date();
        
        if (!earliestStart || start < earliestStart) earliestStart = start;
        if (!latestEnd || end > latestEnd) latestEnd = end;

        const diffMs = end.getTime() - start.getTime();
        totalUsageTimeHours += (diffMs / (1000 * 60 * 60));
      });

      const completedLogs = p.productionLogs.filter(pl => pl.status === 'completed');
      const totalLogs = p.productionLogs.length;
      const statusText = totalLogs > 0 ? `${completedLogs.length}/${totalLogs} Stages Completed` : 'In Progress';

      return {
        id: p.id,
        projectId: p.projectId,
        clientDemand: p.requirements || p.description || 'N/A',
        machinesUsed: Array.from(machinesUsed).join(', ') || 'N/A',
        startTime: earliestStart,
        endTime: latestEnd,
        dateRange: earliestStart && latestEnd ? `${earliestStart.toLocaleDateString()} - ${latestEnd.toLocaleDateString()}` : 'N/A',
        totalUsageTime: totalUsageTimeHours.toFixed(2) + ' hours',
        status: statusText,
        progressPercentage: p.progressPercentage
      };
    });

    fastCache.set('prod_work_orders', formattedWorkOrders, 30);
    res.json(formattedWorkOrders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching active work orders' });
  }
});

// Get production logs by project
router.get('/project/:projectId', authenticate, async (req, res) => {
  try {
    const { projectId } = req.params;
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const query = { $or: [{ projectId: String(projectId) }, { projectId: mongoose.Types.ObjectId.isValid(projectId) ? new mongoose.Types.ObjectId(projectId) : projectId }] };
        const rawLogs = await db.collection('ProductionLog').find(query).sort({ createdAt: 1 }).toArray();
        const machineIds = rawLogs.map((l: any) => l.machineId).filter(Boolean);
        const workerIds = rawLogs.map((l: any) => l.workerId).filter(Boolean);

        const machineObjIds = machineIds.filter((mId: string) => mongoose.Types.ObjectId.isValid(mId)).map((mId: string) => new mongoose.Types.ObjectId(mId));
        const workerObjIds = workerIds.filter((wId: string) => mongoose.Types.ObjectId.isValid(wId)).map((wId: string) => new mongoose.Types.ObjectId(wId));

        const [rawMachines, rawWorkers] = await Promise.all([
          db.collection('Machine').find({ $or: [{ _id: { $in: machineObjIds } }, { id: { $in: machineIds } }] }, { projection: { name: 1 } }).toArray(),
          db.collection('Staff').find({ $or: [{ _id: { $in: workerObjIds } }, { id: { $in: workerIds } }] }, { projection: { name: 1 } }).toArray()
        ]);

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), { name: m.name }));

        const workerMap = new Map();
        rawWorkers.forEach((w: any) => workerMap.set(w._id.toString(), { name: w.name }));

        const enriched = rawLogs.map((l: any) => ({
          ...l,
          id: l._id.toString(),
          machine: l.machineId ? machineMap.get(l.machineId.toString()) || null : null,
          worker: l.workerId ? workerMap.get(l.workerId.toString()) || null : null
        }));

        return res.json(enriched);
      } catch (mErr) {
        console.warn('Mongoose production logs fetch failed:', mErr);
      }
    }

    const logs = await prisma.productionLog.findMany({
      where: { projectId: String(projectId) },
      orderBy: { createdAt: 'asc' },
      include: { machine: { select: { name: true } }, worker: { select: { name: true } } }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching production logs for project' });
  }
});

// Add production log
router.post('/', authenticate, async (req, res) => {
  try {
    const { projectId, stage, machineId, workerId, remarks, quantityProduced, transactionType, productId, productName } = req.body;
    
    const newLog = await prisma.productionLog.create({
      data: {
        projectId,
        stage,
        machineId: machineId || null,
        workerId: workerId || null,
        remarks,
        quantityProduced: Number(quantityProduced) || 0,
        transactionType,
        productId,
        productName,
        status: 'in_progress',
        startTime: new Date()
      }
    });
    
    res.status(201).json(newLog);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating production log' });
  }
});

// Update production log status (completed)
router.patch('/:id/complete', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantityProduced, remarks } = req.body;
    
    const updatedLog = await prisma.productionLog.update({
      where: { id: String(id) },
      data: {
        status: 'completed',
        endTime: new Date(),
        quantityProduced: quantityProduced ? parseFloat(quantityProduced) : undefined,
        remarks: remarks || undefined
      }
    });
    
    // Automatically update project progress
    const project = await prisma.project.findUnique({
      where: { id: updatedLog.projectId! },
      include: { productionLogs: true }
    });
    
    if (project) {
      const completedStages = project.productionLogs.filter((l: any) => l.status === 'completed').length;
      const totalStages = project.productionLogs.length || 1;
      const progressPercentage = Math.round((completedStages / totalStages) * 100);
      
      let projectStatus = project.status;
      if (progressPercentage === 100) projectStatus = 'completed';
      
      await prisma.project.update({
        where: { id: project.id },
        data: { progressPercentage, status: projectStatus }
      });
    }

    res.json(updatedLog);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating production log' });
  }
});

// --- MATERIAL TRACKING ENDPOINTS ---

// Fetch all active/unreturned OUT logs (transactionType: 'OUT', approvalStatus: 'approved', isReturned: false/null)
router.get('/active-out-logs', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('prod_active_out_logs');
    if (cached) return res.json(cached);

    const [allApprovedOutLogs, pendingInLogs] = await Promise.all([
      prisma.productionLog.findMany({
        where: {
          transactionType: 'OUT',
          approvalStatus: 'approved',
          OR: [
            { isReturned: false },
            { isReturned: null }
          ]
        },
        orderBy: { createdAt: 'desc' },
        include: {
          worker: { select: { name: true, staffId: true } },
          project: { select: { name: true, projectId: true, clientName: true } }
        }
      }),
      prisma.productionLog.findMany({
        where: {
          transactionType: 'IN',
          approvalStatus: { in: ['pending', 'redo_in_progress'] },
          parentLogId: { not: null }
        },
        select: {
          parentLogId: true,
          quantityProduced: true
        }
      })
    ]);

    // Subtract pending quantities
    const activeOutLogs = allApprovedOutLogs.filter(log => {
      const pendingReturns = pendingInLogs
        .filter(inLog => inLog.parentLogId === log.id)
        .reduce((sum, inLog) => sum + (inLog.quantityProduced || 0), 0);
        
      const availableQty = (log.quantityProduced || 0) - (log.returnedQty || 0) - pendingReturns;
      
      // Mutate log.returnedQty temporarily so frontend calculates remaining correctly
      (log as any).returnedQty = (log.returnedQty || 0) + pendingReturns;
      
      return availableQty > 0;
    });

    fastCache.set('prod_active_out_logs', activeOutLogs, 15);
    res.json(activeOutLogs);
  } catch (error) {
    console.error("Error fetching active OUT logs:", error);
    res.status(500).json({ message: 'Server error fetching active OUT logs' });
  }
});

// Fetch rejected logs for Manager Dashboard
router.get('/rejected-logs', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('prod_rejected_logs');
    if (cached) return res.json(cached);

    const rejectedLogs = await prisma.productionLog.findMany({
      where: { approvalStatus: { in: ['rejected_admin', 'redo_in_progress'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        worker: { select: { name: true, staffId: true } },
        project: { select: { name: true, projectId: true, clientName: true } }
      }
    });

    fastCache.set('prod_rejected_logs', rejectedLogs, 15);
    res.json(rejectedLogs);
  } catch (error) {
    console.error("Error fetching rejected logs:", error);
    res.status(500).json({ message: 'Server error fetching rejected logs' });
  }
});

// Submit new Material IN/OUT log
const toValidObjectId = (val: any): string | undefined => {
  if (!val || typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return /^[0-9a-fA-F]{24}$/.test(trimmed) ? trimmed : undefined;
};

router.post('/material-log', authenticate, async (req, res) => {
  try {
    let { stage, quantityProduced, transactionType, startPhotos, workerId, vendorName, vendorId, vendors, parentLogId, vehicleNumber, challanNumber, productId, productName, slabId, pieceIds, requiresMachine } = req.body;
    
    // If manager submits an OUT log but says no machine required, 
    // it skips the worker and acts as a direct piece completion (IN log)
    if (transactionType === 'OUT' && requiresMachine === false) {
      transactionType = 'IN';
    }

    let projectId: string | undefined = undefined;
    if (parentLogId && toValidObjectId(parentLogId)) {
      const parentLog = await prisma.productionLog.findUnique({
        where: { id: String(parentLogId).trim() }
      });
      if (parentLog) {
        projectId = toValidObjectId(parentLog.projectId);
        productName = parentLog.productName || productName;
        productId = parentLog.productId || productId;
        slabId = parentLog.slabId || slabId;
        vendorId = parentLog.vendorId || vendorId;
        vendorName = parentLog.vendorName || vendorName;
        stage = parentLog.stage || stage;
      }
    } else {
      projectId = toValidObjectId(req.body.projectId);
    }

    // Handle multiple vendors for OUT/IN transactions
    if (vendors && Array.isArray(vendors) && vendors.length > 0) {
      const newLogs = await Promise.all(vendors.map(async (v: any) => {
        const itemParentLogId = toValidObjectId(v.parentLogId || parentLogId);
        let itemProjectId = toValidObjectId(v.projectId || projectId);
        let itemProductName = (v.productName || productName)?.trim() || undefined;
        let itemProductId = (v.productId || productId)?.trim() || undefined;
        let itemSlabId = toValidObjectId(v.slabId || slabId);
        let itemVendorId = toValidObjectId(v.vendorId);
        let itemVendorName = v.vendorName?.trim() || undefined;
        let itemStage = v.stage || stage;

        if (itemParentLogId) {
          try {
            const pLog = await prisma.productionLog.findUnique({ where: { id: itemParentLogId } });
            if (pLog) {
              if (!itemProjectId) itemProjectId = toValidObjectId(pLog.projectId);
              if (!itemProductName) itemProductName = pLog.productName || undefined;
              if (!itemProductId) itemProductId = pLog.productId || undefined;
              if (!itemSlabId) itemSlabId = toValidObjectId(pLog.slabId);
              if (!itemVendorId) itemVendorId = toValidObjectId(pLog.vendorId);
              if (!itemVendorName) itemVendorName = pLog.vendorName || undefined;
              if (!v.stage) itemStage = pLog.stage || itemStage;
            }
          } catch (e) {
            console.warn("Parent log lookup error:", e);
          }
        }

        const created = await prisma.productionLog.create({
          data: {
            projectId: itemProjectId,
            stage: itemStage,
            quantityProduced: v.qty ? parseFloat(v.qty) : 0,
            transactionType,
            startPhotos,
            workerId: toValidObjectId(workerId),
            vendorName: itemVendorName,
            vendorId: itemVendorId,
            vehicleNumber: vehicleNumber?.trim() || undefined,
            challanNumber: challanNumber?.trim() || undefined,
            boxCode: req.body.boxCode?.trim() || undefined,
            parentLogId: itemParentLogId,
            productId: itemProductId,
            productName: itemProductName,
            slabId: itemSlabId,
            pieceIds: Array.isArray(v.pieceIds) ? v.pieceIds : (Array.isArray(pieceIds) ? pieceIds : []),
            approvalStatus: (req.body.source === 'admin_manual' || itemStage === 'Dispatch') ? 'approved' : 'pending',
            status: 'completed',
            isReturned: false,
            returnedQty: 0
          }
        });

        if (transactionType === 'IN' && itemParentLogId) {
          try {
            const pLog = await prisma.productionLog.findUnique({ where: { id: itemParentLogId } });
            if (pLog) {
              const newReturnedQty = (pLog.returnedQty || 0) + (created.quantityProduced || 0);
              await prisma.productionLog.update({
                where: { id: itemParentLogId },
                data: {
                  returnedQty: newReturnedQty,
                  isReturned: newReturnedQty >= (pLog.quantityProduced || 0)
                }
              });
            }
          } catch (e) {
            console.warn("Failed to update parentLog returnedQty:", e);
          }
        }

        return created;
      }));
      return res.status(201).json(newLogs);
    }

    // Single vendor or regular OUT/IN transaction
    const newLog = await prisma.productionLog.create({
      data: {
        projectId: toValidObjectId(projectId),
        stage,
        quantityProduced: quantityProduced ? parseFloat(quantityProduced) : 0,
        transactionType,
        startPhotos,
        workerId: toValidObjectId(workerId),
        vendorName: vendorName?.trim() || undefined,
        vendorId: toValidObjectId(vendorId),
        vehicleNumber: vehicleNumber?.trim() || undefined,
        challanNumber: challanNumber?.trim() || undefined,
        boxCode: req.body.boxCode?.trim() || undefined,
        parentLogId: toValidObjectId(parentLogId),
        productId: productId?.trim() || undefined,
        productName: productName?.trim() || undefined,
        slabId: toValidObjectId(slabId),
        pieceIds: Array.isArray(pieceIds) ? pieceIds : [],
        approvalStatus: (req.body.source === 'admin_manual' || stage === 'Dispatch') ? 'approved' : 'pending',
        status: 'completed',
        isReturned: false,
        returnedQty: 0
      }
    });

    // If log is auto-approved (e.g. direct Dispatch), automatically update pieces
    if (newLog.approvalStatus === 'approved') {
      try {
        let effectivePieceIds = newLog.pieceIds && newLog.pieceIds.length > 0 ? newLog.pieceIds : [];
        if (effectivePieceIds.length === 0 && newLog.slabId) {
          const slabPieces = await prisma.piece.findMany({
            where: { slabId: String(newLog.slabId) },
            orderBy: { pieceNumber: 'asc' }
          });
          if (slabPieces.length > 0) {
            effectivePieceIds = slabPieces.slice(0, Number(newLog.quantityProduced) || slabPieces.length).map((p: any) => p.id);
          }
        }

        if (effectivePieceIds.length > 0) {
          const cleanStage = (newLog.stage || 'Dispatch').replace(' Work', '').trim();
          for (const pieceId of effectivePieceIds) {
            await prisma.piece.update({
              where: { id: pieceId },
              data: {
                status: 'completed',
                stage: cleanStage
              }
            });
            await prisma.pieceLog.create({
              data: {
                pieceId: pieceId,
                stage: newLog.stage,
                status: 'completed',
                operatorId: newLog.workerId,
                remarks: 'Auto-logged from Direct Dispatch',
                vehicleNumber: newLog.vehicleNumber || undefined,
                endTime: new Date()
              }
            });
          }
        }
      } catch (pieceErr) {
        console.warn('Could not auto-update pieces for approved log:', pieceErr);
      }
    }

    // Update parent log for IN transactions (Partial returns support)
    if (newLog.transactionType === 'IN' && newLog.parentLogId) {
      try {
        const parentLog = await prisma.productionLog.findUnique({ where: { id: newLog.parentLogId } });
        if (parentLog) {
          const newReturnedQty = (parentLog.returnedQty || 0) + (newLog.quantityProduced || 0);
          const isFullyReturned = newReturnedQty >= (parentLog.quantityProduced || 0);
          
          await prisma.productionLog.update({
            where: { id: newLog.parentLogId },
            data: { 
              returnedQty: newReturnedQty,
              isReturned: isFullyReturned 
            }
          });
        }
      } catch (err) {
        console.warn(`Failed to update parentLog returnedQty for ${newLog.parentLogId}:`, err);
      }
    }

    // Invalidate caches
    fastCache.invalidate('prod_');
    fastCache.invalidate('all_projects');
    fastCache.invalidate('slabs_project_');
    fastCache.invalidate('project_hierarchy_v2');
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate('vendor_ledger_');

    res.status(201).json(newLog);
  } catch (error: any) {
    console.error("Material Log Error:", error);
    res.status(500).json({ message: 'Server error creating material log', error: error.message, stack: error.stack });
  }
});

// Fetch pending approvals for Admin
router.get('/pending-approvals', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('prod_pending_approvals');
    if (cached) return res.json(cached);

    let pendingLogs: any[] = [];
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    

    if (db) {
      try {
        const rawLogs = await db.collection('ProductionLog').find({ approvalStatus: 'pending' }).sort({ createdAt: -1 }).toArray();
        const workerIds = rawLogs.map((l: any) => l.workerId).filter(Boolean);
        const projectIds = rawLogs.map((l: any) => l.projectId).filter(Boolean);
        const machineIds = rawLogs.map((l: any) => l.machineId).filter(Boolean);

        const [rawWorkers, rawProjects, rawMachines] = await Promise.all([
          db.collection('User').find({ _id: { $in: workerIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray(),
          db.collection('Project').find({ _id: { $in: projectIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray(),
          db.collection('Machine').find({ _id: { $in: machineIds.map((id: any) => { try { return new mongoose.Types.ObjectId(id); } catch { return id; } }) } }).toArray()
        ]);

        const workerMap = new Map();
        rawWorkers.forEach((w: any) => workerMap.set(w._id.toString(), { name: w.name }));

        const projectMap = new Map();
        rawProjects.forEach((p: any) => projectMap.set(p._id.toString(), { name: p.name, projectId: p.projectId, clientName: p.clientName }));

        const machineMap = new Map();
        rawMachines.forEach((m: any) => machineMap.set(m._id.toString(), { name: m.name }));

        pendingLogs = rawLogs.map((l: any) => ({
          ...l,
          id: l._id.toString(),
          worker: l.workerId ? workerMap.get(l.workerId.toString()) : null,
          project: l.projectId ? projectMap.get(l.projectId.toString()) : null,
          machine: l.machineId ? machineMap.get(l.machineId.toString()) : null
        }));

        fastCache.set('prod_pending_approvals', pendingLogs, 15);
        return res.json(pendingLogs);
      } catch (err) {
        console.warn('Mongoose pending approvals query failed, falling back to Prisma:', err);
      }
    }

    pendingLogs = await prisma.productionLog.findMany({
      where: { approvalStatus: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: {
        worker: { select: { name: true } },
        project: { select: { name: true, projectId: true, clientName: true } },
        machine: { select: { name: true } }
      }
    });

    fastCache.set('prod_pending_approvals', pendingLogs, 15);
    res.json(pendingLogs);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching pending approvals' });
  }
});

// Approve or Reject a material log (Assign Project if approved)

// Approve or Reject a material log (Assign Project if approved)
router.patch('/:id/approve', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus, projectId, splits, remarks } = req.body; // approvalStatus: 'approved' or 'rejected'

    const originalLog = await prisma.productionLog.findUnique({ where: { id: String(id) } });
    if (!originalLog) return res.status(404).json({ message: 'Log not found' });

    let updatedLog;

    if (splits && splits.length > 0 && approvalStatus === 'approved') {
      const totalSplitQty = splits.reduce((acc: number, s: any) => acc + Number(s.qty || 0), 0);
      const rejectedPieces = req.body.rejectedPieces;
      const rejectedQty = rejectedPieces && Number(rejectedPieces.qty) > 0 ? Number(rejectedPieces.qty) : 0;
      const totalHandledQty = totalSplitQty + rejectedQty;
      const remainingPendingQty = (Number(originalLog.quantityProduced) || 0) - totalHandledQty;
      
      const { id: _id, createdAt, updatedAt, ...restLogData } = originalLog;

      // Handle rejected portion if provided
      if (rejectedQty > 0) {
        try {
          const rejectedStartPhotos = {
            ...(typeof originalLog.startPhotos === 'object' && originalLog.startPhotos !== null ? originalLog.startPhotos : {}),
            ...(rejectedPieces.rejectionPhoto ? { rejectionPhoto: rejectedPieces.rejectionPhoto } : {})
          };

          await prisma.productionLog.create({
            data: {
              ...restLogData,
              approvalStatus: 'rejected_admin',
              quantityProduced: rejectedQty,
              remarks: rejectedPieces.remarks || remarks || 'Rejected by Admin during approval',
              pieceIds: rejectedPieces.pieceIds && Array.isArray(rejectedPieces.pieceIds) ? rejectedPieces.pieceIds : [],
              startPhotos: rejectedStartPhotos,
              projectId: originalLog.projectId || (splits[0]?.projectId ? String(splits[0].projectId) : undefined),
              productId: originalLog.productId || (splits[0]?.productId ? String(splits[0].productId) : undefined),
              productName: rejectedPieces.productName || (originalLog.productName ? `${originalLog.productName.split(' - ')[0]} (${rejectedQty} Pcs)` : undefined),
              slabId: originalLog.slabId || (splits[0]?.slabId ? String(splits[0].slabId) : undefined),
            }
          });
        } catch (rejErr) {
          console.warn('Could not create rejected production log during partial approval:', rejErr);
        }
      }

      if (remainingPendingQty > 0) {
        // Partial approval with pending remainder: Keep original log pending with remainder, create new logs for all splits
        updatedLog = await prisma.productionLog.update({
          where: { id: String(id) },
          data: { quantityProduced: remainingPendingQty } // stays pending
        });
        
        for (const split of splits) {
          const newSplitLog = await prisma.productionLog.create({
            data: {
              ...restLogData,
              approvalStatus: 'approved',
              projectId: split.projectId ? String(split.projectId) : undefined,
              productId: split.productId ? String(split.productId) : undefined,
              productName: split.productName ? String(split.productName) : undefined,
              slabId: split.slabId ? String(split.slabId) : undefined,
              pieceIds: split.pieceIds && split.pieceIds.length > 0 ? split.pieceIds : [],
              quantityProduced: Number(split.qty || 1),
              remarks: remarks ? String(remarks) : originalLog.remarks
            }
          });
          
          let effectivePieceIds = split.pieceIds && split.pieceIds.length > 0 ? split.pieceIds : [];
          if (effectivePieceIds.length === 0 && split.slabId) {
            try {
              const slabPieces = await prisma.piece.findMany({
                where: { slabId: String(split.slabId) },
                orderBy: { pieceNumber: 'asc' }
              });
              if (slabPieces.length > 0) {
                effectivePieceIds = slabPieces.slice(0, Number(split.qty) || slabPieces.length).map((p: any) => p.id);
              }
            } catch (pFindErr) {
              console.warn('Could not find pieces for slabId:', split.slabId, pFindErr);
            }
          }

          if (effectivePieceIds.length > 0) {
            for (const pieceId of effectivePieceIds) {
              try {
                const cleanStage = (split.stage ? split.stage : originalLog.stage).replace(' Work', '').trim();
                const pieceStatus = 'completed';
                await prisma.piece.update({
                  where: { id: pieceId },
                  data: { 
                    status: pieceStatus,
                    stage: cleanStage
                  }
                });
                await prisma.pieceLog.create({
                  data: {
                    pieceId: pieceId,
                    stage: originalLog.stage,
                    status: pieceStatus,
                    operatorId: originalLog.workerId,
                    remarks: 'Auto-logged from Material/Machine Approval',
                    vehicleNumber: originalLog.vehicleNumber || undefined,
                    endTime: originalLog.transactionType === 'OUT' ? undefined : new Date()
                  }
                });
              } catch (pieceErr) {
                console.warn(`Failed to update piece ${pieceId}:`, pieceErr);
              }
            }
          }
        }
      } else {
        // Full approval / all handled (splits + optional rejection)
        const firstSplit = splits[0];
        
        updatedLog = await prisma.productionLog.update({
          where: { id: String(id) },
          data: {
            approvalStatus: 'approved',
            projectId: firstSplit.projectId ? String(firstSplit.projectId) : undefined,
            productId: firstSplit.productId ? String(firstSplit.productId) : undefined,
            productName: firstSplit.productName ? String(firstSplit.productName) : undefined,
            slabId: firstSplit.slabId ? String(firstSplit.slabId) : undefined,
            pieceIds: firstSplit.pieceIds && firstSplit.pieceIds.length > 0 ? firstSplit.pieceIds : [],
            quantityProduced: Number(firstSplit.qty || originalLog.quantityProduced),
            remarks: remarks ? String(remarks) : undefined
          }
        });
        
        for (let i = 1; i < splits.length; i++) {
          const split = splits[i];
          await prisma.productionLog.create({
            data: {
              ...restLogData,
              approvalStatus: 'approved',
              projectId: split.projectId ? String(split.projectId) : undefined,
              productId: split.productId ? String(split.productId) : undefined,
              productName: split.productName ? String(split.productName) : undefined,
              slabId: split.slabId ? String(split.slabId) : undefined,
              pieceIds: split.pieceIds && split.pieceIds.length > 0 ? split.pieceIds : [],
              quantityProduced: Number(split.qty || 1),
              remarks: remarks ? String(remarks) : undefined
            }
          });
        }
        
        // Update pieces for all splits including the first one
        for (const split of splits) {
          let effectivePieceIds = split.pieceIds && split.pieceIds.length > 0 ? split.pieceIds : [];
          if (effectivePieceIds.length === 0 && split.slabId) {
            try {
              const slabPieces = await prisma.piece.findMany({
                where: { slabId: String(split.slabId) },
                orderBy: { pieceNumber: 'asc' }
              });
              if (slabPieces.length > 0) {
                effectivePieceIds = slabPieces.slice(0, Number(split.qty) || slabPieces.length).map((p: any) => p.id);
              }
            } catch (pFindErr) {
              console.warn('Could not find slab pieces:', split.slabId, pFindErr);
            }
          }

          if (effectivePieceIds.length > 0) {
            for (const pieceId of effectivePieceIds) {
              try {
                const cleanStage = (split.stage ? split.stage : originalLog.stage).replace(' Work', '').trim();
                const pieceStatus = 'completed';
                await prisma.piece.update({
                  where: { id: pieceId },
                  data: { 
                    status: pieceStatus,
                    stage: cleanStage
                  }
                });
                await prisma.pieceLog.create({
                  data: {
                    pieceId: pieceId,
                    stage: originalLog.stage,
                    status: pieceStatus,
                    operatorId: originalLog.workerId,
                    remarks: 'Auto-logged from Material/Machine Approval',
                    vehicleNumber: originalLog.vehicleNumber || undefined,
                    endTime: originalLog.transactionType === 'OUT' ? undefined : new Date()
                  }
                });
              } catch (pieceErr) {
                console.warn(`Failed to update piece ${pieceId}:`, pieceErr);
              }
            }
          }
          
          // Auto-deduct from Inventory for completed OUT items (or Production Work)
          if (originalLog.transactionType === 'OUT' || originalLog.stage === 'Production Work') {
            try {
              const materialNameToMatch = String(split.productName || originalLog.productName || '').toLowerCase();
              if (materialNameToMatch) {
                const inventories = await prisma.inventory.findMany({});
                const match = inventories.find(inv => 
                  materialNameToMatch.includes(inv.itemName.toLowerCase()) || 
                  inv.itemName.toLowerCase().includes(materialNameToMatch)
                );
                
                if (match) {
                  const qtyToDeduct = Number(split.qty);
                  if (qtyToDeduct > 0) {
                    await prisma.inventory.update({
                      where: { id: match.id },
                      data: { quantity: { decrement: qtyToDeduct } }
                    });
                    
                    const proj = split.projectId ? await prisma.project.findUnique({ where: { id: String(split.projectId) } }) : null;
                    
                    if (split.projectId) {
                      const pm = await prisma.projectMaterial.findFirst({
                        where: { projectId: String(split.projectId), inventoryId: match.id, isConsumed: false }
                      });
                      if (pm) {
                        const waste = Math.max(0, pm.quantity - qtyToDeduct);
                        await prisma.projectMaterial.update({
                          where: { id: pm.id },
                          data: { isConsumed: true, usedQuantity: qtyToDeduct, wasteQuantity: waste }
                        });
                      }
                    }

                    await prisma.inventoryLog.create({
                      data: {
                        inventoryId: match.id,
                        type: 'OUT',
                        quantity: qtyToDeduct,
                        remarks: `Used in Project: ${proj?.name || 'Unknown'}`
                      }
                    });
                  }
                }
              }
            } catch (invErr) {
              console.warn('Inventory deduction warning in split approval:', invErr);
            }
          }
        }
      }

      // If this is an IN log, apply the returns to pending OUT logs (FIFO)
      if (originalLog.transactionType === 'IN') {
        for (const split of splits) {
          try {
            let remainingToReturn = Number(split.qty);
            
            const whereClause: any = {
              transactionType: 'OUT',
              approvalStatus: 'approved',
              stage: originalLog.stage,
            };
            if (originalLog.workerId) {
              whereClause.workerId = originalLog.workerId;
            } else if (originalLog.vendorName) {
              whereClause.vendorName = originalLog.vendorName;
            }

            const pendingOutLogs = await prisma.productionLog.findMany({
              where: whereClause,
              orderBy: { createdAt: 'asc' }
            });
            
            for (const outLog of pendingOutLogs) {
              if (remainingToReturn <= 0) break;
              
              const qtyProduced = Number(outLog.quantityProduced) || 0;
              const returnedQty = Number(outLog.returnedQty) || 0;
              const pendingQty = qtyProduced - returnedQty;
              
              if (pendingQty > 0) {
                const returnAmount = Math.min(pendingQty, remainingToReturn);
                const updatedPieceIds = Array.from(new Set([...(outLog.pieceIds || []), ...(split.pieceIds || [])]));
                await prisma.productionLog.update({
                  where: { id: outLog.id },
                  data: {
                    returnedQty: returnedQty + returnAmount,
                    isReturned: (returnedQty + returnAmount) >= qtyProduced,
                    projectId: split.projectId ? String(split.projectId) : undefined,
                    productId: split.productId ? String(split.productId) : undefined,
                    productName: split.productName ? String(split.productName) : undefined,
                    slabId: split.slabId ? String(split.slabId) : undefined,
                    pieceIds: updatedPieceIds
                  }
                });
                remainingToReturn -= returnAmount;
              }
            }
          } catch (fifoErr) {
            console.warn('FIFO return tracking warning:', fifoErr);
          }
        }
      }
    } else {
      // Rejection or direct approval without splits
      const { id: _id, createdAt, updatedAt, ...restLogData } = originalLog;
      const rejectedQty = Number(req.body.rejectedQty || originalLog.quantityProduced) || 0;
      const rejPhoto = req.body.rejectionPhoto || req.body.startPhotos?.rejectionPhoto;
      const mergedStartPhotos = {
        ...(typeof originalLog.startPhotos === 'object' && originalLog.startPhotos !== null ? originalLog.startPhotos : {}),
        ...(req.body.startPhotos || {}),
        ...(rejPhoto ? { rejectionPhoto: rejPhoto } : {})
      };

      if (approvalStatus === 'rejected_admin' && rejectedQty < (Number(originalLog.quantityProduced) || 0) && rejectedQty > 0) {
        // Partial rejection: split into rejected log and remaining pending log
        const remainingQty = (Number(originalLog.quantityProduced) || 0) - rejectedQty;
        await prisma.productionLog.update({
          where: { id: String(id) },
          data: { quantityProduced: remainingQty }
        });

        updatedLog = await prisma.productionLog.create({
          data: {
            ...restLogData,
            approvalStatus: 'rejected_admin',
            quantityProduced: rejectedQty,
            remarks: remarks !== undefined ? String(remarks) : undefined,
            startPhotos: mergedStartPhotos,
            productName: req.body.productName || (originalLog.productName ? `${originalLog.productName.split(' - ')[0]} (${rejectedQty} Pcs)` : undefined),
            ...(req.body.pieceIds && { pieceIds: req.body.pieceIds })
          }
        });
      } else {
        updatedLog = await prisma.productionLog.update({
          where: { id: String(id) },
          data: {
            approvalStatus,
            projectId: projectId ? String(projectId) : undefined,
            remarks: remarks !== undefined ? String(remarks) : undefined,
            ...(req.body.machineId && { machineId: req.body.machineId }),
            startPhotos: mergedStartPhotos,
            ...(req.body.pieceIds && { pieceIds: req.body.pieceIds })
          }
        });

        // Auto-deduct from Inventory for completed OUT items (or Production Work)
        if (approvalStatus === 'approved' && (updatedLog.transactionType === 'OUT' || updatedLog.stage === 'Production Work')) {
          try {
            const materialNameToMatch = String(updatedLog.productName || originalLog.productName || '').toLowerCase();
            if (materialNameToMatch) {
              const inventories = await prisma.inventory.findMany({});
              const match = inventories.find(inv => 
                materialNameToMatch.includes(inv.itemName.toLowerCase()) || 
                inv.itemName.toLowerCase().includes(materialNameToMatch)
              );
              
              if (match) {
                const qtyToDeduct = Number(updatedLog.quantityProduced);
                if (qtyToDeduct > 0) {
                  await prisma.inventory.update({
                    where: { id: match.id },
                    data: { quantity: { decrement: qtyToDeduct } }
                  });
                  
                  const proj = updatedLog.projectId ? await prisma.project.findUnique({ where: { id: String(updatedLog.projectId) } }) : null;
                  
                  if (updatedLog.projectId) {
                    const pm = await prisma.projectMaterial.findFirst({
                      where: { projectId: String(updatedLog.projectId), inventoryId: match.id, isConsumed: false }
                    });
                    if (pm) {
                      const waste = Math.max(0, pm.quantity - qtyToDeduct);
                      await prisma.projectMaterial.update({
                        where: { id: pm.id },
                        data: { isConsumed: true, usedQuantity: qtyToDeduct, wasteQuantity: waste }
                      });
                    }
                  }

                  await prisma.inventoryLog.create({
                    data: {
                      inventoryId: match.id,
                      type: 'OUT',
                      quantity: qtyToDeduct,
                      remarks: `Used in Project Approval: ${proj?.name || 'Unknown'}`
                    }
                  });
                }
              }
            }
          } catch (invErr) {
            console.warn('Inventory deduction warning in non-split approval:', invErr);
          }
        }
      }
    }

    if (updatedLog && updatedLog.transactionType === 'IN' && updatedLog.parentLogId) {
      try {
        if (updatedLog.stage === 'Production Work') {
          const totalApprovedQty = splits && splits.length > 0 && approvalStatus === 'approved' 
            ? splits.reduce((acc: number, s: any) => acc + Number(s.qty || 0), 0)
            : updatedLog.quantityProduced;
            
          const combinedProductName = splits && splits.length > 0 && approvalStatus === 'approved'
            ? splits.map((s: any) => s.productName).filter(Boolean).join(' | ')
            : updatedLog.productName;
            
          await prisma.machineLog.update({
            where: { id: updatedLog.parentLogId },
            data: { 
              approvalStatus: approvalStatus, 
              status: 'completed',
              projectId: updatedLog.projectId || undefined,
              quantityProduced: totalApprovedQty || 0,
              productName: combinedProductName || undefined
            }
          });
        } else {
          const parentLogExists = await prisma.productionLog.findUnique({ where: { id: updatedLog.parentLogId } });
          if (parentLogExists) {
            await prisma.productionLog.update({
              where: { id: updatedLog.parentLogId },
              data: { isReturned: true }
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to update parentLogId ${updatedLog.parentLogId}:`, err);
      }
    }

    // Invalidate caches
    fastCache.invalidate('prod_');
    fastCache.invalidate('all_projects');
    fastCache.invalidate('slabs_project_');
    fastCache.invalidate('project_hierarchy_v2');
    fastCache.invalidate('all_names_v2');
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate('vendor_ledger_');

    res.json(updatedLog || originalLog);
  } catch (error: any) {
    console.error("Material Log Error:", error);
    res.status(500).json({ message: error.message || 'Server error updating material log approval' });
  }
});

// Manual Bulk Approval of Pieces for Active Work Orders
router.post('/manual-approve-pieces', authenticate, async (req: any, res: any) => {
  try {
    const { projectId, slabId, pieceIds, stage, approvals, remarks = 'Manually Approved by Admin' } = req.body;
    
    // Normalize approval items into array of { pieceId, stage }
    let approvalList: { pieceId: string, stage: string }[] = [];

    if (Array.isArray(approvals) && approvals.length > 0) {
      approvalList = approvals.map((a: any) => ({
        pieceId: String(a.pieceId),
        stage: String(a.stage || 'Production').replace(' Work', '').trim()
      }));
    } else if (Array.isArray(pieceIds) && pieceIds.length > 0) {
      const defaultStage = String(stage || 'Production').replace(' Work', '').trim();
      approvalList = pieceIds.map((pid: string) => ({
        pieceId: String(pid),
        stage: defaultStage
      }));
    }

    if (approvalList.length === 0) {
      return res.status(400).json({ message: 'No piece approvals provided' });
    }

    const uniquePieceIds = Array.from(new Set(approvalList.map(a => a.pieceId)));

    // 1. Fetch pieces to get details
    const pieces = await prisma.piece.findMany({
      where: { id: { in: uniquePieceIds } },
      include: { slab: true }
    });

    if (pieces.length === 0) {
      return res.status(404).json({ message: 'No matching pieces found' });
    }

    const pieceMap = new Map(pieces.map(p => [p.id, p]));

    // 2. Group approvals by stage and slab to update piece records and create clean production logs
    const stageSlabMap: { [stage: string]: { [slabId: string]: any[] } } = {};

    for (const item of approvalList) {
      const p = pieceMap.get(item.pieceId);
      if (!p) continue;
      const stg = item.stage;
      const sId = p.slabId || 'default';
      
      if (!stageSlabMap[stg]) stageSlabMap[stg] = {};
      if (!stageSlabMap[stg][sId]) stageSlabMap[stg][sId] = [];
      stageSlabMap[stg][sId].push(p);
    }

    const createdLogs = [];
    const targetProjectId = projectId || pieces[0]?.slab?.projectId;

    for (const [stg, slabGroups] of Object.entries(stageSlabMap)) {
      for (const [sId, groupPieces] of Object.entries(slabGroups)) {
        if (!groupPieces || groupPieces.length === 0) continue;
        const groupPieceIds = groupPieces.map(p => p.id);
        const firstPiece = groupPieces[0];
        const targetSlab = firstPiece?.slab;
        const pieceNames = groupPieces.map(p => p.productName || `Piece ${p.pieceNumber}`).join(', ');

        // Update piece status and stage
        await prisma.piece.updateMany({
          where: { id: { in: groupPieceIds } },
          data: {
            status: 'completed',
            stage: stg
          }
        });

        // Create approved production log for audit and In/Out tracking
        try {
          const log = await prisma.productionLog.create({
            data: {
              projectId: targetProjectId ? String(targetProjectId) : undefined,
              slabId: targetSlab ? targetSlab.id : (sId !== 'default' ? sId : undefined),
              productId: targetSlab?.id,
              productName: targetSlab ? `${targetSlab.name} - ${pieceNames}` : pieceNames,
              pieceIds: groupPieceIds,
              quantityProduced: groupPieces.length,
              stage: stg.includes('Work') ? stg : `${stg} Work`,
              transactionType: 'IN',
              approvalStatus: 'approved',
              remarks: remarks || `Manual Direct Approval for ${stg}: ${groupPieces.length} pieces (${pieceNames})`,
              workerId: req.user?.id ? String(req.user.id) : undefined
            }
          });
          createdLogs.push(log);
        } catch (logErr) {
          console.warn('Could not create ProductionLog record during manual approval:', logErr);
        }

        // Also create PieceLog entries in a single fast bulk insert
        try {
          const pieceLogsData = groupPieces.map(p => ({
            pieceId: p.id,
            stage: stg,
            status: 'approved',
            operatorId: req.user?.id ? String(req.user.id) : undefined,
            remarks: 'Manual Direct Approval',
            endTime: new Date()
          }));
          if (pieceLogsData.length > 0) {
            await prisma.pieceLog.createMany({ data: pieceLogsData });
          }
        } catch (plErr) {
          console.warn('PieceLog createMany warning:', plErr);
        }
      }
    }

    // Invalidate caches
    fastCache.invalidate('slabs_project_');
    fastCache.invalidate('all_projects');
    fastCache.invalidate('project_hierarchy_v2');
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate('vendor_ledger_');

    res.json({
      success: true,
      message: `Successfully approved ${approvalList.length} stage item(s) across ${uniquePieceIds.length} piece(s)`,
      count: approvalList.length,
      logs: createdLogs
    });
  } catch (error: any) {
    console.error('Manual piece approval error:', error);
    res.status(500).json({ message: error.message || 'Server error during manual piece approval' });
  }
});

// Fetch approved material logs for Production Management
router.get('/approved-logs', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('prod_approved_logs');
    if (cached) return res.json(cached);

    const approvedLogs = await prisma.productionLog.findMany({
      where: { approvalStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        worker: { select: { name: true } },
        project: { select: { name: true, projectId: true, clientName: true } }
      }
    });

    fastCache.set('prod_approved_logs', approvedLogs, 15);
    res.json(approvedLogs);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching approved logs' });
  }
});

// Update returnedQty for partial/full returns on OUT material logs
router.patch('/:id/return', authenticate, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { returnedQty, returnDate } = req.body;

    const log = await prisma.productionLog.findUnique({ where: { id: String(id) } });
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const prevReturned = (log as any).returnedQty || 0;
    const newReturnedQty = prevReturned + Number(returnedQty || 0);
    const isFullyReturned = newReturnedQty >= (log.quantityProduced || 0);

    const updated = await prisma.productionLog.update({
      where: { id: String(id) },
      data: {
        returnedQty: newReturnedQty,
        isReturned: isFullyReturned,
        returnDate: returnDate ? new Date(returnDate) : new Date()
      } as any
    });

    fastCache.invalidate('prod_');
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate('vendor_ledger_');
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error recording material return' });
  }
});

// Edit material log
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { quantityProduced, returnedQty, stage, projectId, productId, productName, slabId, pieceIds, vehicleNumber, transactionType, vendorId, vendorName, workerId, workerName, date, photoUrl, startPhotos } = req.body;
    
    // Get the log first to know its type and stage
    const log = await prisma.productionLog.findUnique({ where: { id: req.params.id as string } });
    if (!log) return res.status(404).json({ message: 'Log not found' });
    
    let updateData: any = {
      quantityProduced: quantityProduced !== undefined ? Number(quantityProduced) : undefined,
      returnedQty: returnedQty !== undefined ? Number(returnedQty) : undefined,
      stage: stage ? String(stage) : undefined,
      projectId: projectId ? String(projectId) : undefined,
      productId: productId ? String(productId) : undefined,
      productName: productName ? String(productName) : undefined,
      slabId: slabId ? String(slabId) : undefined,
      pieceIds: pieceIds ? pieceIds : undefined,
      vehicleNumber: vehicleNumber !== undefined ? String(vehicleNumber) : undefined,
      transactionType: transactionType ? String(transactionType) : undefined,
      vendorId: vendorId !== undefined ? String(vendorId) : undefined,
      vendorName: vendorName !== undefined ? String(vendorName) : undefined,
      workerId: workerId !== undefined ? String(workerId) : undefined,
    };

    if (date) {
      updateData.createdAt = new Date(date);
    }
    
    if (startPhotos) {
      updateData.startPhotos = startPhotos;
    }

    const updated = await prisma.productionLog.update({
      where: { id: req.params.id as string },
      data: updateData
    });
    
    // If pieceIds were provided and the log is approved, update the pieces!
    if (pieceIds && Array.isArray(pieceIds) && log.approvalStatus === 'approved') {
        for (const pieceId of pieceIds) {
           const pieceStatus = 'completed';
           await prisma.piece.update({
              where: { id: String(pieceId) },
              data: {
                 status: pieceStatus,
                 stage: log.stage.replace(' Work', '').trim()
              }
           });
        }
    }
    
    fastCache.invalidate('prod_');
    fastCache.invalidate('all_projects');
    fastCache.invalidate('slabs_project_');
    fastCache.invalidate('project_hierarchy_v2');
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate('vendor_ledger_');

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error editing material log' });
  }
});

// Delete material log
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await prisma.productionLog.delete({
      where: { id: req.params.id as string }
    });
    fastCache.invalidate('prod_');
    fastCache.invalidate('all_projects');
    fastCache.invalidate('slabs_project_');
    fastCache.invalidate('project_hierarchy_v2');
    fastCache.invalidate('vendors_stats');
    fastCache.invalidate('vendor_ledger_');
    res.json({ message: 'Material log deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting material log' });
  }
});

export default router;

