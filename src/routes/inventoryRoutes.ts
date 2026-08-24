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

    const inventory = await prisma.inventory.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    const [logsBeforeFy, logsDuringFy] = await Promise.all([
      // Logs before the FY to calculate Opening Stock correctly from total quantity
      // Actually, opening stock = current quantity - (net IN during FY + net IN after FY) + (net OUT during FY + net OUT after FY)
      // Or simpler: opening stock = current quantity - net movement from start of FY to now.
      prisma.inventoryLog.findMany({
        where: { createdAt: { gte: startOfFy } }
      }),
      prisma.inventoryLog.findMany({
        where: { createdAt: { gte: startOfFy, lte: endOfFy } }
      })
    ]);
    
    const enrichedInventory = inventory.map(item => {
      // Calculate net change from start of FY to now
      const logsFromStartOfFyToNow = logsBeforeFy.filter(l => l.inventoryId === item.id);
      const inSinceStartOfFy = logsFromStartOfFyToNow.filter(l => l.type === 'IN').reduce((acc, curr) => acc + curr.quantity, 0);
      const outSinceStartOfFy = logsFromStartOfFyToNow.filter(l => l.type === 'OUT').reduce((acc, curr) => acc + curr.quantity, 0);
      const netChangeSinceStartOfFy = inSinceStartOfFy - outSinceStartOfFy;
      
      const openingStock = item.quantity - netChangeSinceStartOfFy;
      
      // Calculate IN and OUT during the selected FY
      const itemLogs = logsDuringFy.filter(l => l.inventoryId === item.id);
      const inQty = itemLogs.filter(l => l.type === 'IN').reduce((acc, curr) => acc + curr.quantity, 0);
      const outQty = itemLogs.filter(l => l.type === 'OUT').reduce((acc, curr) => acc + curr.quantity, 0);
      
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
    const { id } = req.params;
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

export default router;
