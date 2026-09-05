"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get inventory items with FY stats
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { fyYear } = req.query;
        // Determine Financial Year start and end dates
        const now = new Date();
        let currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const selectedFyYear = fyYear ? parseInt(fyYear, 10) : currentFyYear;
        const startOfFy = new Date(selectedFyYear, 3, 1); // April 1st
        const endOfFy = new Date(selectedFyYear + 1, 2, 31, 23, 59, 59, 999); // March 31st
        const [inventory, logsBeforeFy, logsDuringFy] = await Promise.all([
            index_1.prisma.inventory.findMany({
                orderBy: { createdAt: 'desc' }
            }),
            index_1.prisma.inventoryLog.findMany({
                where: { createdAt: { gte: startOfFy } },
                select: { inventoryId: true, type: true, quantity: true }
            }),
            index_1.prisma.inventoryLog.findMany({
                where: { createdAt: { gte: startOfFy, lte: endOfFy } },
                select: { inventoryId: true, type: true, quantity: true }
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
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching inventory' });
    }
});
// Add new inventory item
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { type, jobWorkType, itemName, blockNumber, thickness, length, width, height, weight, quantity, unit, supplier, costPerUnit } = req.body;
        const newItem = await index_1.prisma.inventory.create({
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
            await index_1.prisma.inventoryLog.create({
                data: {
                    inventoryId: newItem.id,
                    type: 'IN',
                    quantity: Number(quantity),
                    remarks: 'Initial stock addition'
                }
            });
        }
        res.status(201).json(newItem);
    }
    catch (error) {
        console.error('Error creating inventory item:', error);
        res.status(500).json({ message: 'Server error creating inventory item' });
    }
});
// Update stock (in/out)
router.patch('/:id/stock', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const { quantityChange, remarks } = req.body; // positive for IN, negative for OUT
        const item = await index_1.prisma.inventory.findUnique({ where: { id: String(id) } });
        if (!item)
            return res.status(404).json({ message: 'Item not found' });
        // Update inventory quantity
        const updatedItem = await index_1.prisma.inventory.update({
            where: { id: String(id) },
            data: { quantity: item.quantity + Number(quantityChange) }
        });
        // Create InventoryLog
        await index_1.prisma.inventoryLog.create({
            data: {
                inventoryId: String(id),
                type: Number(quantityChange) >= 0 ? 'IN' : 'OUT',
                quantity: Math.abs(Number(quantityChange)),
                remarks: remarks || 'Manual stock update'
            }
        });
        res.json(updatedItem);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error updating stock' });
    }
});
// Get logs by inventory item ID
router.get('/item-logs/:inventoryId', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { inventoryId } = req.params;
        const logs = await index_1.prisma.inventoryLog.findMany({
            where: { inventoryId: String(inventoryId) },
            orderBy: { createdAt: 'asc' }, // Ascending to calculate balance easily
            include: {
                inventory: {
                    select: { id: true, itemName: true, blockNumber: true, length: true, width: true, thickness: true, unit: true, quantity: true, supplier: true }
                }
            }
        });
        res.json(logs);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching item logs' });
    }
});
// Get logs by supplier
router.get('/logs/:supplier', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { supplier } = req.params;
        // Find all inventory items for this supplier
        const inventoryItems = await index_1.prisma.inventory.findMany({
            where: { supplier: String(supplier) },
            select: { id: true, itemName: true, blockNumber: true, length: true, width: true, thickness: true, unit: true }
        });
        const inventoryIds = inventoryItems.map(i => i.id);
        // Get all logs for those items
        const logs = await index_1.prisma.inventoryLog.findMany({
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
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching logs' });
    }
});
// Manual deduct stock (and optional waste)
router.post('/deduct', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { inventoryId, usedQuantity, wasteQuantity, projectName, date } = req.body;
        const used = Number(usedQuantity) || 0;
        const waste = Number(wasteQuantity) || 0;
        const totalDeduct = used + waste;
        if (!inventoryId || totalDeduct <= 0) {
            return res.status(400).json({ message: 'Invalid quantities' });
        }
        const item = await index_1.prisma.inventory.findUnique({ where: { id: inventoryId } });
        if (!item)
            return res.status(404).json({ message: 'Item not found' });
        // We allow deducting more than available if they really want, but let's check
        if (item.quantity < totalDeduct) {
            return res.status(400).json({ message: 'Not enough stock available' });
        }
        // Update inventory quantity
        await index_1.prisma.inventory.update({
            where: { id: inventoryId },
            data: { quantity: item.quantity - totalDeduct }
        });
        const createdAt = date ? new Date(date) : new Date();
        // Create OUT log for Used
        if (used > 0) {
            await index_1.prisma.inventoryLog.create({
                data: {
                    inventoryId: inventoryId,
                    type: 'OUT',
                    quantity: used,
                    remarks: projectName ? `Project: ${projectName}` : 'Manual Deduction',
                    createdAt: createdAt
                }
            });
        }
        // Create OUT log for Waste
        if (waste > 0) {
            await index_1.prisma.inventoryLog.create({
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error deducting stock' });
    }
});
// Edit log
router.put('/logs/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const { quantity, remarks, date } = req.body;
        const log = await index_1.prisma.inventoryLog.findUnique({ where: { id } });
        if (!log)
            return res.status(404).json({ message: 'Log not found' });
        const updateData = {};
        if (remarks !== undefined)
            updateData.remarks = remarks;
        if (date !== undefined)
            updateData.createdAt = new Date(date);
        if (quantity !== undefined && Number(quantity) !== log.quantity) {
            const newQty = Number(quantity);
            const diff = newQty - log.quantity;
            const inventory = await index_1.prisma.inventory.findUnique({ where: { id: log.inventoryId } });
            if (inventory) {
                if (log.type === 'OUT') {
                    // If we increase OUT (diff > 0), we SUBTRACT from inventory stock
                    // If we decrease OUT (diff < 0), we ADD back to inventory stock
                    if (inventory.quantity - diff < 0) {
                        return res.status(400).json({ message: 'Not enough stock available for this edit' });
                    }
                    await index_1.prisma.inventory.update({
                        where: { id: inventory.id },
                        data: { quantity: inventory.quantity - diff }
                    });
                }
                else if (log.type === 'IN') {
                    // If we increase IN (diff > 0), we ADD to inventory stock
                    // If we decrease IN (diff < 0), we SUBTRACT from inventory stock
                    await index_1.prisma.inventory.update({
                        where: { id: inventory.id },
                        data: { quantity: inventory.quantity + diff }
                    });
                }
            }
            updateData.quantity = newQty;
        }
        const updated = await index_1.prisma.inventoryLog.update({
            where: { id },
            data: updateData
        });
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error updating log' });
    }
});
// Delete log
router.delete('/logs/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const log = await index_1.prisma.inventoryLog.findUnique({ where: { id } });
        if (!log)
            return res.status(404).json({ message: 'Log not found' });
        const inventory = await index_1.prisma.inventory.findUnique({ where: { id: log.inventoryId } });
        if (inventory) {
            if (log.type === 'OUT') {
                // Restore stock
                await index_1.prisma.inventory.update({
                    where: { id: inventory.id },
                    data: { quantity: inventory.quantity + log.quantity }
                });
            }
            else if (log.type === 'IN') {
                // Remove stock
                await index_1.prisma.inventory.update({
                    where: { id: inventory.id },
                    data: { quantity: inventory.quantity - log.quantity }
                });
            }
        }
        await index_1.prisma.inventoryLog.delete({ where: { id } });
        res.json({ message: 'Log deleted successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error deleting log' });
    }
});
exports.default = router;
//# sourceMappingURL=inventoryRoutes.js.map