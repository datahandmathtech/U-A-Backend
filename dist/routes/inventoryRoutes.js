"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get inventory items with monthly stats
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const inventory = await index_1.prisma.inventory.findMany({
            orderBy: { createdAt: 'desc' }
        });
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [balances, logs] = await Promise.all([
            index_1.prisma.dailyStockBalance.findMany({
                where: { date: { gte: startOfMonth } },
                orderBy: { date: 'asc' }
            }),
            index_1.prisma.inventoryLog.findMany({
                where: { createdAt: { gte: startOfMonth } }
            })
        ]);
        const enrichedInventory = inventory.map(item => {
            // Find the earliest balance for this month as opening stock
            const itemBalances = balances.filter(b => b.inventoryId === item.id);
            const openingStock = itemBalances.length > 0 ? itemBalances[0].openingQty : item.quantity;
            const itemLogs = logs.filter(l => l.inventoryId === item.id);
            const inQty = itemLogs.filter(l => l.type === 'IN').reduce((acc, curr) => acc + curr.quantity, 0);
            const outQty = itemLogs.filter(l => l.type === 'OUT').reduce((acc, curr) => acc + curr.quantity, 0);
            return {
                ...item,
                openingStock,
                inCurrentMonth: inQty,
                outCurrentMonth: outQty,
                closingStock: item.quantity
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
                costPerUnit: Number(costPerUnit)
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
        res.status(500).json({ message: 'Server error creating inventory item' });
    }
});
// Update stock (in/out)
router.patch('/:id/stock', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
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
exports.default = router;
//# sourceMappingURL=inventoryRoutes.js.map