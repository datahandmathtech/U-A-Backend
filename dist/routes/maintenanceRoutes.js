"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
const fastCache_1 = require("../utils/fastCache");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// GET all maintenance records and stats
router.get('/', auth_1.authenticate, async (req, res) => {
    try {
        const { machineId, paymentStatus, category, startDate, endDate } = req.query;
        const where = {};
        if (machineId)
            where.machineId = String(machineId);
        if (paymentStatus)
            where.paymentStatus = String(paymentStatus);
        if (category)
            where.category = String(category);
        if (startDate || endDate) {
            where.serviceDate = {};
            if (startDate)
                where.serviceDate.gte = new Date(String(startDate));
            if (endDate) {
                const end = new Date(String(endDate));
                end.setHours(23, 59, 59, 999);
                where.serviceDate.lte = end;
            }
        }
        const maintenances = await index_1.prisma.machineMaintenance.findMany({
            where,
            orderBy: { serviceDate: 'desc' },
            include: {
                machine: {
                    select: { id: true, name: true, type: true }
                },
                createdBy: {
                    select: { id: true, name: true }
                }
            }
        });
        // Compute stats
        let totalExpense = 0;
        let totalPaid = 0;
        let totalDue = 0;
        const machineCostMap = {};
        maintenances.forEach((m) => {
            totalExpense += m.amount;
            if (m.paymentStatus === 'Paid') {
                totalPaid += m.amount;
            }
            else {
                totalDue += m.amount;
            }
            const mKey = m.machineId;
            if (!machineCostMap[mKey]) {
                machineCostMap[mKey] = {
                    name: m.machine?.name || 'Unknown Machine',
                    type: m.machine?.type || 'Machine',
                    totalCost: 0,
                    count: 0
                };
            }
            machineCostMap[mKey].totalCost += m.amount;
            machineCostMap[mKey].count += 1;
        });
        res.json({
            stats: {
                totalExpense: Math.round(totalExpense * 100) / 100,
                totalPaid: Math.round(totalPaid * 100) / 100,
                totalDue: Math.round(totalDue * 100) / 100,
                dueCount: maintenances.filter(m => m.paymentStatus === 'Due').length,
                totalCount: maintenances.length,
                machineBreakdown: Object.values(machineCostMap)
            },
            maintenances
        });
    }
    catch (error) {
        console.error('Error fetching machine maintenances:', error);
        res.status(500).json({ message: 'Error fetching machine maintenances', error: error.message });
    }
});
// POST create machine maintenance record
router.post('/', auth_1.authenticate, async (req, res) => {
    try {
        const { machineId, category, workDescription, partsReplaced, vendorName, technicianName, billNumber, billPhoto, amount, paymentStatus = 'Paid', paymentMode = 'Cash', serviceDate, nextServiceDate, nextServiceHours, notes } = req.body;
        if (!machineId || !category || !workDescription || amount === undefined) {
            return res.status(400).json({ message: 'Machine, category, work description, and amount are required' });
        }
        const numAmount = parseFloat(String(amount));
        if (isNaN(numAmount) || numAmount < 0) {
            return res.status(400).json({ message: 'Valid amount is required' });
        }
        const machine = await index_1.prisma.machine.findUnique({
            where: { id: String(machineId) }
        });
        if (!machine) {
            return res.status(404).json({ message: 'Selected machine not found' });
        }
        const sDate = serviceDate ? new Date(serviceDate) : new Date();
        // 1. Create Maintenance record
        const maintenance = await index_1.prisma.machineMaintenance.create({
            data: {
                machineId: String(machineId),
                category: category.trim(),
                workDescription: workDescription.trim(),
                partsReplaced: partsReplaced?.trim() || null,
                vendorName: vendorName?.trim() || null,
                technicianName: technicianName?.trim() || null,
                billNumber: billNumber?.trim() || null,
                billPhoto: billPhoto || null,
                amount: numAmount,
                paymentStatus: paymentStatus === 'Due' ? 'Due' : 'Paid',
                paymentMode: paymentMode || 'Cash',
                serviceDate: sDate,
                nextServiceDate: nextServiceDate ? new Date(nextServiceDate) : null,
                nextServiceHours: nextServiceHours ? parseFloat(String(nextServiceHours)) : null,
                notes: notes?.trim() || null,
                createdById: req.user?.id || undefined
            }
        });
        // 2. 2-WAY AUTOMATIC SYNC TO CASH BOOK:
        // If bill is Paid via Cash, automatically create OUT entry in Cash Book!
        if (maintenance.paymentStatus === 'Paid' && (paymentMode === 'Cash' || paymentMode === 'Galla' || !paymentMode)) {
            try {
                const cashTx = await index_1.prisma.cashTransaction.create({
                    data: {
                        type: 'OUT',
                        amount: numAmount,
                        category: 'Machine Maintenance & Parts',
                        description: `${machine.name}: ${category} - ${workDescription}${partsReplaced ? ` (Parts: ${partsReplaced})` : ''}`,
                        paidToReceivedFrom: vendorName || technicianName || `${machine.name} Maintenance`,
                        paymentMode: 'Cash',
                        voucherNumber: billNumber || `MAINT-${maintenance.id.slice(-6).toUpperCase()}`,
                        receiptPhoto: billPhoto || null,
                        date: sDate,
                        sourceModule: 'maintenance',
                        sourceId: maintenance.id,
                        createdById: req.user?.id || undefined
                    }
                });
                // Link cash transaction ID to maintenance
                await index_1.prisma.machineMaintenance.update({
                    where: { id: maintenance.id },
                    data: { cashTransactionId: cashTx.id }
                });
            }
            catch (cashErr) {
                console.error('Error syncing maintenance to cash book:', cashErr);
            }
        }
        fastCache_1.fastCache.clearAll();
        res.status(201).json(maintenance);
    }
    catch (error) {
        console.error('Error creating machine maintenance:', error);
        res.status(500).json({ message: 'Error creating machine maintenance', error: error.message });
    }
});
// POST settle dues for a Due maintenance bill
router.post('/:id/settle-dues', auth_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentMode = 'Cash', paymentDate } = req.body;
        const maintenance = await index_1.prisma.machineMaintenance.findUnique({
            where: { id: String(id) },
            include: { machine: true }
        });
        if (!maintenance) {
            return res.status(404).json({ message: 'Maintenance record not found' });
        }
        const payDate = paymentDate ? new Date(paymentDate) : new Date();
        let cashTxId = maintenance.cashTransactionId;
        // If paying via Cash, create Cash Book entry
        if (paymentMode === 'Cash' || paymentMode === 'Galla') {
            try {
                const cashTx = await index_1.prisma.cashTransaction.create({
                    data: {
                        type: 'OUT',
                        amount: maintenance.amount,
                        category: 'Machine Maintenance & Parts',
                        description: `Settle Due: ${maintenance.machine?.name || 'Machine'} - ${maintenance.category} (${maintenance.workDescription})`,
                        paidToReceivedFrom: maintenance.vendorName || maintenance.technicianName || 'Garage / Technician',
                        paymentMode: 'Cash',
                        voucherNumber: maintenance.billNumber || `DUE-SETTLE-${maintenance.id.slice(-6).toUpperCase()}`,
                        receiptPhoto: maintenance.billPhoto || null,
                        date: payDate,
                        sourceModule: 'maintenance',
                        sourceId: maintenance.id,
                        createdById: req.user?.id || undefined
                    }
                });
                cashTxId = cashTx.id;
            }
            catch (cashErr) {
                console.error('Error creating cash entry on due settlement:', cashErr);
            }
        }
        const updated = await index_1.prisma.machineMaintenance.update({
            where: { id: String(id) },
            data: {
                paymentStatus: 'Paid',
                paymentMode: paymentMode,
                cashTransactionId: cashTxId
            }
        });
        fastCache_1.fastCache.clearAll();
        res.json({ success: true, maintenance: updated });
    }
    catch (error) {
        console.error('Error settling maintenance dues:', error);
        res.status(500).json({ message: 'Error settling maintenance dues', error: error.message });
    }
});
// PUT update maintenance record
router.put('/:id', auth_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { machineId, category, workDescription, partsReplaced, vendorName, technicianName, billNumber, billPhoto, amount, paymentStatus, paymentMode, serviceDate, nextServiceDate, nextServiceHours, notes } = req.body;
        const data = {};
        if (machineId)
            data.machineId = String(machineId);
        if (category !== undefined)
            data.category = category.trim();
        if (workDescription !== undefined)
            data.workDescription = workDescription.trim();
        if (partsReplaced !== undefined)
            data.partsReplaced = partsReplaced?.trim() || null;
        if (vendorName !== undefined)
            data.vendorName = vendorName?.trim() || null;
        if (technicianName !== undefined)
            data.technicianName = technicianName?.trim() || null;
        if (billNumber !== undefined)
            data.billNumber = billNumber?.trim() || null;
        if (billPhoto !== undefined)
            data.billPhoto = billPhoto || null;
        if (amount !== undefined)
            data.amount = parseFloat(String(amount));
        if (paymentStatus !== undefined)
            data.paymentStatus = paymentStatus;
        if (paymentMode !== undefined)
            data.paymentMode = paymentMode;
        if (serviceDate !== undefined)
            data.serviceDate = new Date(serviceDate);
        if (nextServiceDate !== undefined)
            data.nextServiceDate = nextServiceDate ? new Date(nextServiceDate) : null;
        if (nextServiceHours !== undefined)
            data.nextServiceHours = nextServiceHours ? parseFloat(String(nextServiceHours)) : null;
        if (notes !== undefined)
            data.notes = notes?.trim() || null;
        const updated = await index_1.prisma.machineMaintenance.update({
            where: { id: String(id) },
            data,
            include: { machine: true }
        });
        // Sync to linked Cash Transaction if present
        if (updated.cashTransactionId) {
            try {
                await index_1.prisma.cashTransaction.update({
                    where: { id: updated.cashTransactionId },
                    data: {
                        amount: updated.amount,
                        description: `${updated.machine?.name || 'Machine'}: ${updated.category} - ${updated.workDescription}`,
                        paidToReceivedFrom: updated.vendorName || updated.technicianName || 'Machine Technician',
                        voucherNumber: updated.billNumber,
                        receiptPhoto: updated.billPhoto,
                        date: updated.serviceDate
                    }
                });
            }
            catch (cashErr) {
                console.error('Error syncing cash transaction on maintenance update:', cashErr);
            }
        }
        fastCache_1.fastCache.clearAll();
        res.json(updated);
    }
    catch (error) {
        console.error('Error updating machine maintenance:', error);
        res.status(500).json({ message: 'Error updating machine maintenance', error: error.message });
    }
});
// DELETE maintenance record
router.delete('/:id', auth_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await index_1.prisma.machineMaintenance.findUnique({
            where: { id: String(id) }
        });
        if (!existing) {
            return res.status(404).json({ message: 'Maintenance record not found' });
        }
        // If linked to cash book, delete linked cash transaction
        if (existing.cashTransactionId) {
            await index_1.prisma.cashTransaction.deleteMany({
                where: { id: existing.cashTransactionId }
            }).catch(() => { });
        }
        await index_1.prisma.machineMaintenance.delete({
            where: { id: String(id) }
        });
        fastCache_1.fastCache.clearAll();
        res.json({ success: true, message: 'Maintenance record and associated cash entry deleted' });
    }
    catch (error) {
        console.error('Error deleting machine maintenance:', error);
        res.status(500).json({ message: 'Error deleting machine maintenance', error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=maintenanceRoutes.js.map