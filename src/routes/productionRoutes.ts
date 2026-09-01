import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Get production logs
router.get('/', authenticate, async (req, res) => {
  try {
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
    const projects = await prisma.project.findMany({
      where: { status: 'work_order' },
      include: {
        machineLogs: {
          include: { machine: true }
        },
        productionLogs: true
      }
    });

    const formattedWorkOrders = projects.map(p => {
      let totalUsageTimeHours = 0;
      let earliestStart = null as Date | null;
      let latestEnd = null as Date | null;
      let machinesUsed = new Set<string>();

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
    const allApprovedOutLogs = await prisma.productionLog.findMany({
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
        project: { select: { name: true, projectId: true } }
      }
    });

    const pendingInLogs = await prisma.productionLog.findMany({
      where: {
        transactionType: 'IN',
        approvalStatus: { in: ['pending', 'redo_in_progress'] },
        parentLogId: { not: null }
      }
    });

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

    res.json(activeOutLogs);
  } catch (error) {
    console.error("Error fetching active OUT logs:", error);
    res.status(500).json({ message: 'Server error fetching active OUT logs' });
  }
});

// Fetch rejected logs for Manager Dashboard
router.get('/rejected-logs', authenticate, async (req, res) => {
  try {
    const rejectedLogs = await prisma.productionLog.findMany({
      where: { approvalStatus: { in: ['rejected_admin', 'redo_in_progress'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        worker: { select: { name: true, staffId: true } },
        project: { select: { name: true, projectId: true } }
      }
    });
    res.json(rejectedLogs);
  } catch (error) {
    console.error("Error fetching rejected logs:", error);
    res.status(500).json({ message: 'Server error fetching rejected logs' });
  }
});

// Submit new Material IN/OUT log
router.post('/material-log', authenticate, async (req, res) => {
  try {
    let { stage, quantityProduced, transactionType, startPhotos, workerId, vendorName, vendorId, vendors, parentLogId, vehicleNumber, challanNumber, productId, productName, slabId, pieceIds, requiresMachine } = req.body;
    
    // If manager submits an OUT log but says no machine required, 
    // it skips the worker and acts as a direct piece completion (IN log)
    if (transactionType === 'OUT' && requiresMachine === false) {
      transactionType = 'IN';
    }

    let projectId = undefined;
    if (parentLogId) {
      const parentLog = await prisma.productionLog.findUnique({
        where: { id: parentLogId }
      });
      if (parentLog) {
        projectId = parentLog.projectId || undefined;
        productName = parentLog.productName || productName;
        productId = parentLog.productId || productId;
        slabId = parentLog.slabId || slabId;
      }
    } else {
      projectId = req.body.projectId;
    }

    // Handle multiple vendors for OUT/IN transactions
    if (vendors && Array.isArray(vendors) && vendors.length > 0) {
      const newLogs = await Promise.all(vendors.map(async (v: any) => {
        return prisma.productionLog.create({
          data: {
            projectId,
            stage: v.stage || stage,
            quantityProduced: v.qty ? parseFloat(v.qty) : 0,
            transactionType,
            startPhotos,
            workerId: workerId?.trim() || undefined,
            vendorName: v.vendorName?.trim() || undefined,
            vendorId: v.vendorId?.trim() || undefined,
            vehicleNumber: vehicleNumber?.trim() || undefined,
            challanNumber: challanNumber?.trim() || undefined,
            productId: productId?.trim() || undefined,
            productName: productName?.trim() || undefined,
            slabId: slabId?.trim() || undefined,
            pieceIds: v.pieceIds || pieceIds || [],
            approvalStatus: (req.body.source === 'admin_manual') ? 'approved' : 'pending',
            status: 'completed',
            isReturned: false,
            returnedQty: 0
          }
        });
      }));
      return res.status(201).json(newLogs);
    }

    // Single vendor or regular OUT/IN transaction
    const newLog = await prisma.productionLog.create({
      data: {
        projectId,
        stage,
        quantityProduced: quantityProduced ? parseFloat(quantityProduced) : 0,
        transactionType,
        startPhotos,
        workerId: workerId?.trim() || undefined,
        vendorName: vendorName?.trim() || undefined,
        vendorId: vendorId?.trim() || undefined,
        vehicleNumber: vehicleNumber?.trim() || undefined,
        challanNumber: challanNumber?.trim() || undefined,
        parentLogId: parentLogId?.trim() || undefined,
        productId: productId?.trim() || undefined,
        productName: productName?.trim() || undefined,
        slabId: slabId?.trim() || undefined,
        pieceIds: pieceIds || [],
        approvalStatus: (req.body.source === 'admin_manual') ? 'approved' : 'pending',
        status: 'completed',
        isReturned: false,
        returnedQty: 0
      }
    });

    // Update parent log for IN transactions (Partial returns support)
    if (newLog.transactionType === 'IN' && newLog.parentLogId) {
      try {
        const parentLog = await prisma.productionLog.findUnique({ where: { id: newLog.parentLogId } });
        if (parentLog) {
          // Calculate new returned qty
          // But wait, the IN log requires admin approval. Should we update the balance now or after approval?
          // The old code updated `isReturned` only if `newLog.approvalStatus === 'approved'`.
          // Let's update it immediately so staff sees it, or wait for approval.
          // Usually, it's safer to just track it based on the IN logs' sum later.
          // For now, let's update it immediately.
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

    res.status(201).json(newLog);
  } catch (error: any) {
    console.error("Material Log Error:", error);
    res.status(500).json({ message: 'Server error creating material log', error: error.message, stack: error.stack });
  }
});

// Fetch pending approvals for Admin
router.get('/pending-approvals', authenticate, async (req, res) => {
  try {
    const pendingLogs = await prisma.productionLog.findMany({
      where: { approvalStatus: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: {
        worker: { select: { name: true } }
      }
    });
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
      const totalSplitQty = splits.reduce((acc: number, s: any) => acc + Number(s.qty), 0);
      const remainingQty = (originalLog.quantityProduced || 0) - totalSplitQty;
      
      const { id: _id, createdAt, updatedAt, ...restLogData } = originalLog;

      if (remainingQty > 0) {
        // Partial approval: Keep original log pending with remainder, create new logs for all splits
        updatedLog = await prisma.productionLog.update({
          where: { id: String(id) },
          data: { quantityProduced: remainingQty } // stays pending
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
              quantityProduced: Number(split.qty),
              remarks: remarks ? String(remarks) : originalLog.remarks
            }
          });
          
          if (split.pieceIds && split.pieceIds.length > 0) {
            for (const pieceId of split.pieceIds) {
              const pieceStatus = originalLog.transactionType === 'OUT' ? 'active' : 'completed';
              await prisma.piece.update({
                where: { id: pieceId },
                data: { 
                  status: pieceStatus,
                  ...(split.stage && { stage: split.stage })
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
            }
          }
        }
      } else {
        // Full approval
        const firstSplit = splits[0];
        
        updatedLog = await prisma.productionLog.update({
          where: { id: String(id) },
          data: {
            approvalStatus,
            projectId: firstSplit.projectId ? String(firstSplit.projectId) : undefined,
            productId: firstSplit.productId ? String(firstSplit.productId) : undefined,
            productName: firstSplit.productName ? String(firstSplit.productName) : undefined,
            slabId: firstSplit.slabId ? String(firstSplit.slabId) : undefined,
            pieceIds: firstSplit.pieceIds && firstSplit.pieceIds.length > 0 ? firstSplit.pieceIds : [],
            quantityProduced: Number(firstSplit.qty),
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
              quantityProduced: Number(split.qty),
              remarks: remarks ? String(remarks) : undefined
            }
          });
        }
        
        // Update pieces for all splits including the first one
        for (const split of splits) {
          if (split.pieceIds && split.pieceIds.length > 0) {
            for (const pieceId of split.pieceIds) {
              const pieceStatus = originalLog.transactionType === 'OUT' ? 'active' : 'completed';
              await prisma.piece.update({
                where: { id: pieceId },
                data: { 
                  status: pieceStatus,
                  stage: originalLog.stage.replace(' Work', '')
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
            }
          }
          
          // Auto-deduct from Inventory for completed OUT items (or Production Work)
          if (originalLog.transactionType === 'OUT' || originalLog.stage === 'Production Work') {
            const materialNameToMatch = String(split.productName || originalLog.productName || '').toLowerCase();
            if (materialNameToMatch) {
              // Find matching inventory items
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
                  
                  // Update ProjectMaterial for Waste Ledger
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
          }
        }
      }

      // If this is an IN log, apply the returns to pending OUT logs (FIFO)
      if (originalLog.transactionType === 'IN') {
        for (const split of splits) {
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
            
            const qtyProduced = outLog.quantityProduced || 0;
            const returnedQty = outLog.returnedQty || 0;
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
        }
      }
    } else {
        updatedLog = await prisma.productionLog.update({
          where: { id: String(id) },
          data: {
            approvalStatus,
            projectId: projectId ? String(projectId) : undefined,
            remarks: remarks !== undefined ? String(remarks) : undefined,
            ...(req.body.machineId && { machineId: req.body.machineId }),
            ...(req.body.startPhotos && { startPhotos: req.body.startPhotos })
          }
        });

        // Auto-deduct from Inventory for completed OUT items (or Production Work)
        if (approvalStatus === 'approved' && (updatedLog.transactionType === 'OUT' || updatedLog.stage === 'Production Work')) {
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
                
                // Update ProjectMaterial for Waste Ledger
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
        }
      }

    if (updatedLog.transactionType === 'IN' && updatedLog.parentLogId) {
      try {
        if (updatedLog.stage === 'Production Work') {
          const totalApprovedQty = splits && splits.length > 0 && approvalStatus === 'approved' 
            ? splits.reduce((acc: number, s: any) => acc + Number(s.qty), 0)
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
          await prisma.productionLog.update({
            where: { id: updatedLog.parentLogId },
            data: { isReturned: true }
          });
        }
      } catch (err) {
        console.warn(`Failed to update parentLogId ${updatedLog.parentLogId}:`, err);
      }
    }

    res.json(updatedLog);
  } catch (error: any) {
    console.error("Material Log Error:", error);
    require('fs').writeFileSync('C:\\Users\\ABHAY\\.gemini\\antigravity\\brain\\ef5a82a2-0db7-4636-a7d5-c9f7739376d2\\scratch\\error.log', String(error) + '\n' + (error.stack || ''));
    res.status(500).json({ message: error.message || 'Server error updating material log approval' });
  }
});

// Fetch approved material logs for Production Management
router.get('/approved-logs', authenticate, async (req, res) => {
  try {
    const approvedLogs = await prisma.productionLog.findMany({
      where: { approvalStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      include: {
        worker: { select: { name: true } },
        project: { select: { name: true, projectId: true, clientName: true } }
      }
    });
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
      workerName: workerName !== undefined ? String(workerName) : undefined,
      photoUrl: photoUrl !== undefined ? String(photoUrl) : undefined,
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
          const pieceStatus = log.transactionType === 'OUT' ? 'active' : 'completed';
          await prisma.piece.update({
             where: { id: String(pieceId) },
             data: {
                status: pieceStatus,
                stage: log.stage.replace(' Work', '')
             }
          });
       }
    }
    
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
    res.json({ message: 'Material log deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting material log' });
  }
});

export default router;
