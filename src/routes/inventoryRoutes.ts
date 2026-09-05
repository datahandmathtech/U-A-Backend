import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Get inventory items with FY stats
router.get('/', authenticate, async (req, res) => {
  try {
    const { fyYear } = req.query;
    
    // Determine Financial Year start and end dates
    const now = new Date();
    let currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const selectedFyYear = fyYear ? parseInt(fyYear as string, 10) : currentFyYear;
    
    const startOfFy = new Date(selectedFyYear, 3, 1); // April 1st
    const endOfFy = new Date(selectedFyYear + 1, 2, 31, 23, 59, 59, 999); // March 31st

    const [inventory, logsSinceStartOfFy] = await Promise.all([
      prisma.inventory.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          projectMaterials: {
            include: {
              project: {
                select: { id: true, name: true, projectId: true, clientName: true }
              }
            }
          },
          slabs: {
            include: {
              project: {
                select: { id: true, name: true, projectId: true, clientName: true }
              }
            }
          }
        }
      }),
      prisma.inventoryLog.findMany({
        where: { createdAt: { gte: startOfFy } },
        select: { inventoryId: true, type: true, quantity: true, createdAt: true }
      })
    ]);
    
    // Fast O(1) aggregation Maps
    const netChangeMap = new Map<string, number>();
    const inQtyMap = new Map<string, number>();
    const outQtyMap = new Map<string, number>();

    const endOfFyTime = endOfFy.getTime();

    for (const log of logsSinceStartOfFy) {
      const net = netChangeMap.get(log.inventoryId) || 0;
      netChangeMap.set(log.inventoryId, net + (log.type === 'IN' ? log.quantity : -log.quantity));

      if (log.createdAt.getTime() <= endOfFyTime) {
        if (log.type === 'IN') {
          inQtyMap.set(log.inventoryId, (inQtyMap.get(log.inventoryId) || 0) + log.quantity);
        } else if (log.type === 'OUT') {
          outQtyMap.set(log.inventoryId, (outQtyMap.get(log.inventoryId) || 0) + log.quantity);
        }
      }
    }

    const enrichedInventory = inventory.map(item => {
      const netChangeSinceStartOfFy = netChangeMap.get(item.id) || 0;
      const openingStock = item.quantity - netChangeSinceStartOfFy;
      const inQty = inQtyMap.get(item.id) || 0;
      const outQty = outQtyMap.get(item.id) || 0;
      
      return {
        ...item,
        openingStock,
        inCurrentFY: inQty,
        outCurrentFY: outQty,
        closingStock: openingStock + inQty - outQty
      };
    });

    res.json(enrichedInventory);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching inventory' });
  }
});

// Add new inventory item
router.post('/', authenticate, async (req, res) => {
  try {
    const { type, jobWorkType, itemName, blockNumber, thickness, length, width, height, weight, quantity, unit, supplier, costPerUnit } = req.body;
    
    const newItem = await prisma.inventory.create({
      data: {
        type,
        jobWorkType: jobWorkType || 'company',
        itemName,
        blockNumber,
        thickness: thickness ? Number(thickness) : null,
        length: length ? Number(length) : null,
        width: width ? Number(width) : null,
        height: height ? Number(height) : null,
        weight: weight ? Number(weight) : null,
        quantity: Number(quantity),
        unit,
        supplier,
        costPerUnit: costPerUnit ? Number(costPerUnit) : 0
      }
    });
    
    // Create initial InventoryLog
    if (Number(quantity) > 0) {
      await prisma.inventoryLog.create({
        data: {
          inventoryId: newItem.id,
          type: 'IN',
          quantity: Number(quantity),
          remarks: 'Initial stock addition'
        }
      });
    }
    
    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(500).json({ message: 'Server error creating inventory item' });
  }
});

// Update stock (in/out)
router.patch('/:id/stock', authenticate, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { quantityChange, remarks } = req.body; // positive for IN, negative for OUT
    
    const item = await prisma.inventory.findUnique({ where: { id: String(id) } });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    
    // Update inventory quantity
    const updatedItem = await prisma.inventory.update({
      where: { id: String(id) },
      data: { quantity: item.quantity + Number(quantityChange) }
    });
    
    // Create InventoryLog
    await prisma.inventoryLog.create({
      data: {
        inventoryId: String(id),
        type: Number(quantityChange) >= 0 ? 'IN' : 'OUT',
        quantity: Math.abs(Number(quantityChange)),
        remarks: remarks || 'Manual stock update'
      }
    });
    
    res.json(updatedItem);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating stock' });
  }
});

// Get logs by inventory item ID
router.get('/item-logs/:inventoryId', authenticate, async (req, res) => {
  try {
    const { inventoryId } = req.params;
    const item = await prisma.inventory.findUnique({
      where: { id: String(inventoryId) },
      include: {
        projectMaterials: {
          include: {
            project: true
          }
        },
        slabs: {
          include: {
            project: true
          }
        }
      }
    });
    const logs = await prisma.inventoryLog.findMany({
      where: { inventoryId: String(inventoryId) },
      orderBy: { createdAt: 'asc' }, // Ascending to calculate balance easily
      include: {
        inventory: {
           select: { id: true, itemName: true, blockNumber: true, length: true, width: true, thickness: true, unit: true, quantity: true, supplier: true }
        }
      }
    });
    res.json({ item, logs });
  } catch (error) {
    console.error('Error fetching item logs:', error);
    res.status(500).json({ message: 'Server error fetching item logs' });
  }
});

// Get logs by supplier
router.get('/logs/:supplier', authenticate, async (req, res) => {
  try {
    const { supplier } = req.params;
    
    // Find all inventory items for this supplier or project
    const inventoryItems = await prisma.inventory.findMany({
      where: {
        OR: [
          { supplier: String(supplier) },
          {
            projectMaterials: {
              some: {
                project: {
                  OR: [
                    { name: String(supplier) },
                    { projectId: String(supplier) },
                    { clientName: String(supplier) }
                  ]
                }
              }
            }
          },
          {
            slabs: {
              some: {
                project: {
                  OR: [
                    { name: String(supplier) },
                    { projectId: String(supplier) },
                    { clientName: String(supplier) }
                  ]
                }
              }
            }
          }
        ]
      },
      select: { id: true, itemName: true, blockNumber: true, length: true, width: true, thickness: true, unit: true, supplier: true }
    });

    const inventoryIds = inventoryItems.map(i => i.id);

    // Get all logs for those items
    const logs = await prisma.inventoryLog.findMany({
      where: { inventoryId: { in: inventoryIds } },
      orderBy: { createdAt: 'desc' }
    });

    // Map logs to include inventory details
    const logsWithDetails = logs.map(log => {
      const item = inventoryItems.find(i => i.id === log.inventoryId);
      return {
        ...log,
        inventory: item
      };
    });

    res.json(logsWithDetails);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching logs' });
  }
});


// Manual deduct stock (and optional waste)
router.post('/deduct', authenticate, async (req, res) => {
  try {
    const { inventoryId, usedQuantity, wasteQuantity, projectName, projectId, slabId, pieceId, pieceName, length, width, thickness, date } = req.body;
    
    const used = Number(usedQuantity) || 0;
    const waste = Number(wasteQuantity) || 0;
    const totalDeduct = used + waste;

    if (!inventoryId || totalDeduct <= 0) {
      return res.status(400).json({ message: 'Invalid quantities' });
    }

    const item = await prisma.inventory.findUnique({ where: { id: inventoryId } });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    
    // We allow deducting more than available if they really want, but let's check
    if (item.quantity < totalDeduct) {
      return res.status(400).json({ message: 'Not enough stock available' });
    }

    // Update inventory quantity
    await prisma.inventory.update({
      where: { id: inventoryId },
      data: { quantity: item.quantity - totalDeduct }
    });

    // Link Piece to this Inventory Item via ProjectMaterial
    let targetProjectId = projectId;
    if (pieceId) {
      const piece = await prisma.piece.findUnique({
        where: { id: pieceId },
        include: { slab: true }
      });

      if (piece) {
        targetProjectId = targetProjectId || piece.slab?.projectId;
        if (targetProjectId) {
          let projMat = await prisma.projectMaterial.findFirst({
            where: {
              projectId: targetProjectId,
              inventoryId: inventoryId
            }
          });

          if (!projMat) {
            projMat = await prisma.projectMaterial.create({
              data: {
                projectId: targetProjectId,
                inventoryId: inventoryId,
                quantity: used,
                usedQuantity: used,
                cost: 0
              }
            });
          } else {
            projMat = await prisma.projectMaterial.update({
              where: { id: projMat.id },
              data: {
                quantity: (projMat.quantity || 0) + used,
                usedQuantity: (projMat.usedQuantity || 0) + used
              }
            });
          }

          const usedSizeStr = (length && width) ? `${length}L x ${width}W${thickness ? ` | ${thickness}MM` : ''}` : null;

          await prisma.piece.update({
            where: { id: pieceId },
            data: { 
              sourceMaterialId: projMat.id,
              vendorName: usedSizeStr
            }
          });
        }
      }
    }

    if (slabId) {
      await prisma.slab.update({
        where: { id: slabId },
        data: { inventoryId: inventoryId }
      }).catch(() => {});
    }

    const createdAt = date ? new Date(date) : new Date();

    // Clean project and piece name remarks only
    let outRemarks = projectName ? `${projectName}${pieceName ? ` (${pieceName})` : ''}` : 'Manual Deduction';

    // Create OUT log for Used
    if (used > 0) {
      await prisma.inventoryLog.create({
        data: {
          inventoryId: inventoryId,
          type: 'OUT',
          quantity: used,
          remarks: outRemarks,
          createdAt: createdAt
        }
      });
    }

    // Create OUT log for Waste
    if (waste > 0) {
      await prisma.inventoryLog.create({
        data: {
          inventoryId: inventoryId,
          type: 'OUT',
          quantity: waste,
          remarks: 'Waste',
          createdAt: createdAt
        }
      });
    }

    res.json({ message: 'Stock deducted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error deducting stock' });
  }
});


// Edit log
router.put('/logs/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { quantity, remarks, date } = req.body;
    
    const log = await prisma.inventoryLog.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ message: 'Log not found' });
    
    const updateData: any = {};
    if (remarks !== undefined) updateData.remarks = remarks;
    if (date !== undefined) updateData.createdAt = new Date(date);
    
    if (quantity !== undefined && Number(quantity) !== log.quantity) {
      const newQty = Number(quantity);
      const diff = newQty - log.quantity;
      
      const inventory = await prisma.inventory.findUnique({ where: { id: log.inventoryId } });
      if (inventory) {
        if (log.type === 'OUT') {
          // If we increase OUT (diff > 0), we SUBTRACT from inventory stock
          // If we decrease OUT (diff < 0), we ADD back to inventory stock
          if (inventory.quantity - diff < 0) {
             return res.status(400).json({ message: 'Not enough stock available for this edit' });
          }
          await prisma.inventory.update({
            where: { id: inventory.id },
            data: { quantity: inventory.quantity - diff }
          });
        } else if (log.type === 'IN') {
          // If we increase IN (diff > 0), we ADD to inventory stock
          // If we decrease IN (diff < 0), we SUBTRACT from inventory stock
          await prisma.inventory.update({
            where: { id: inventory.id },
            data: { quantity: inventory.quantity + diff }
          });
        }
      }
      updateData.quantity = newQty;
    }
    
    const updated = await prisma.inventoryLog.update({
      where: { id },
      data: updateData
    });
    
    res.json(updated);
  } catch(error) {
    console.error(error);
    res.status(500).json({ message: 'Error updating log' });
  }
});

// Delete log
router.delete('/logs/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id as string;
    const log = await prisma.inventoryLog.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ message: 'Log not found' });
    
    const inventory = await prisma.inventory.findUnique({ where: { id: log.inventoryId } });
    if (inventory) {
      if (log.type === 'OUT') {
        // Restore stock
        await prisma.inventory.update({
          where: { id: inventory.id },
          data: { quantity: inventory.quantity + log.quantity }
        });

        // If log was for a piece, unlink piece sourceMaterialId
        if (log.remarks) {
          const match = log.remarks.match(/Piece:\s*([^)]+)/);
          const pieceName = match && match[1] ? match[1].trim() : '';
          if (pieceName) {
            const p = await prisma.piece.findFirst({
              where: {
                OR: [
                  { productName: pieceName },
                  { productName: { contains: pieceName } }
                ]
              }
            });
            if (p) {
              await prisma.piece.update({
                where: { id: p.id },
                data: { sourceMaterialId: null, vendorName: null }
              }).catch(() => {});
            }
          }
        }
      } else if (log.type === 'IN') {
        // Remove stock
        await prisma.inventory.update({
          where: { id: inventory.id },
          data: { quantity: inventory.quantity - log.quantity }
        });
      }
    }
    
    await prisma.inventoryLog.delete({ where: { id } });
    res.json({ message: 'Log deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error deleting log' });
  }
});

export default router;

