"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
const fastCache_1 = require("../utils/fastCache");
const router = express_1.default.Router();
// Get all vendors
router.get('/', async (req, res) => {
    try {
        const { month, fy } = req.query;
        const cacheKey = `vendors_stats_${fy || 'default'}_${month || 'all'}`;
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const today = new Date();
        let startOfFY, endOfFY;
        if (fy && typeof fy === 'string' && fy !== 'undefined') {
            const parts = String(fy).split(' ');
            const yearPart = parts[1] || `${new Date().getFullYear()}`;
            const yearStr = yearPart.split('-')[0] || `${new Date().getFullYear()}`;
            const fyStartYear = parseInt(yearStr, 10);
            startOfFY = new Date(`${fyStartYear}-04-01T00:00:00.000Z`);
            endOfFY = new Date(`${fyStartYear + 1}-03-31T23:59:59.999Z`);
        }
        else {
            const currentYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
            startOfFY = new Date(`${currentYear}-04-01T00:00:00.000Z`);
            endOfFY = new Date(`${currentYear + 1}-03-31T23:59:59.999Z`);
        }
        let vendors = [];
        let allLogs = [];
        let dbSuccess = false;
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const rawVendors = await db.collection('Vendor').find({ status: 'active' }).sort({ createdAt: -1 }).toArray();
                const { ObjectId } = mongoose.Types;
                const vendorObjIds = rawVendors.map((v) => v._id);
                const vendorStringIds = rawVendors.map((v) => v._id.toString());
                const vendorNames = rawVendors.map((v) => v.name).filter(Boolean);
                const rawLogs = await db.collection('ProductionLog').find({
                    $or: [
                        { vendorId: { $in: [...vendorObjIds, ...vendorStringIds] } },
                        { vendorName: { $in: vendorNames } }
                    ],
                    createdAt: { $gte: startOfFY, $lte: endOfFY }
                }).toArray();
                vendors = rawVendors.map((v) => ({ ...v, id: v._id.toString() }));
                allLogs = rawLogs.map((l) => ({
                    ...l,
                    id: l._id.toString(),
                    vendorIdStr: l.vendorId ? l.vendorId.toString() : '',
                    createdAt: new Date(l.createdAt)
                }));
                dbSuccess = true;
            }
            catch (mErr) {
                console.warn('Mongoose vendors fetch failed:', mErr);
            }
        }
        if (!dbSuccess) {
            vendors = await index_1.prisma.vendor.findMany({
                where: { status: 'active' },
                orderBy: { createdAt: 'desc' }
            });
            const vendorNames = vendors.map(v => v.name).filter(Boolean);
            allLogs = await index_1.prisma.productionLog.findMany({
                where: {
                    OR: [
                        { vendorId: { in: vendors.map(v => v.id) } },
                        { vendorName: { in: vendorNames } }
                    ],
                    createdAt: { gte: startOfFY, lte: endOfFY }
                }
            });
            allLogs = allLogs.map((l) => ({
                ...l,
                vendorIdStr: l.vendorId ? l.vendorId.toString() : '',
                createdAt: new Date(l.createdAt)
            }));
        }
        const vendorStats = vendors.map((vendor) => {
            const logs = allLogs.filter(log => {
                const vIdStr = log.vendorIdStr || (log.vendorId ? log.vendorId.toString() : '');
                const vNameStr = log.vendorName ? log.vendorName.trim().toLowerCase() : '';
                const curNameStr = vendor.name ? vendor.name.trim().toLowerCase() : '';
                return (vIdStr && vIdStr === vendor.id) || (vNameStr && curNameStr && vNameStr === curNameStr);
            });
            let filteredLogs = logs;
            let pastLogs = [];
            let openingBalance = 0;
            if (month && month !== 'All' && month !== 'undefined') {
                filteredLogs = logs.filter((log) => {
                    const d = new Date(log.createdAt);
                    const monthStr = `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`;
                    return monthStr === month;
                });
                // Determine chronological start of the selected month to find past logs
                const selectedMonthParts = String(month).split(' ');
                const monthMap = { 'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5, 'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11 };
                const monthName = selectedMonthParts[0] || '';
                const monthNum = monthMap[monthName];
                const yearNum = parseInt(selectedMonthParts[1] || '0');
                if (monthNum !== undefined && yearNum) {
                    const startOfSelectedMonth = new Date(yearNum, monthNum, 1);
                    pastLogs = logs.filter(log => new Date(log.createdAt) < startOfSelectedMonth);
                    const pastOut = pastLogs.reduce((acc, log) => acc + (log.transactionType === 'OUT' ? (log.quantityProduced || 0) : 0), 0);
                    const pastIn = pastLogs.reduce((acc, log) => acc + (log.transactionType === 'IN' ? (log.quantityProduced || 0) : 0), 0);
                    openingBalance = pastOut - pastIn;
                }
            }
            const totalOut = filteredLogs.reduce((acc, log) => acc + (log.transactionType === 'OUT' ? (log.quantityProduced || 0) : 0), 0);
            const totalIn = filteredLogs.reduce((acc, log) => acc + (log.transactionType === 'IN' ? (log.quantityProduced || 0) : 0), 0);
            return {
                ...vendor,
                openingBalance,
                totalOut,
                totalIn,
                balance: openingBalance + totalOut - totalIn
            };
        });
        fastCache_1.fastCache.set(cacheKey, vendorStats, 120);
        res.json(vendorStats);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch vendors' });
    }
});
// Get single vendor ledger
router.get('/:id/ledger', async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `vendor_ledger_${id}`;
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const today = new Date();
        const currentYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        const startOfFY = new Date(`${currentYear}-04-01T00:00:00.000Z`);
        const endOfFY = new Date(`${currentYear + 1}-03-31T23:59:59.999Z`);
        const mongoose = require('mongoose');
        const db = mongoose.connection?.db;
        let logs = [];
        let dbSuccess = false;
        if (db) {
            try {
                const { ObjectId } = mongoose.Types;
                const objId = ObjectId.isValid(id) ? new ObjectId(id) : null;
                const vendor = await db.collection('Vendor').findOne({
                    $or: [
                        ...(objId ? [{ _id: objId }] : []),
                        { _id: id }
                    ]
                });
                const queryOr = [
                    ...(objId ? [{ vendorId: objId }] : []),
                    { vendorId: id }
                ];
                if (vendor?.name) {
                    queryOr.push({ vendorName: vendor.name });
                }
                const rawLogs = await db.collection('ProductionLog').find({
                    $or: queryOr,
                    createdAt: { $gte: startOfFY, $lte: endOfFY }
                }).sort({ createdAt: 1 }).toArray();
                const projectIds = rawLogs.map((l) => l.projectId).filter(Boolean);
                const projects = await db.collection('Project').find({
                    _id: { $in: projectIds.map((pid) => ObjectId.isValid(pid) ? new ObjectId(pid) : pid) }
                }).toArray();
                const projectMap = new Map();
                projects.forEach((p) => {
                    projectMap.set(p._id.toString(), p.name);
                });
                logs = rawLogs.map((l) => ({
                    ...l,
                    id: l._id.toString(),
                    project: l.projectId ? { name: projectMap.get(l.projectId.toString()) || '' } : undefined,
                    createdAt: new Date(l.createdAt)
                }));
                dbSuccess = true;
            }
            catch (mErr) {
                console.warn('Mongoose vendor ledger fetch failed:', mErr);
            }
        }
        if (!dbSuccess) {
            logs = await index_1.prisma.productionLog.findMany({
                where: {
                    vendorId: id,
                    createdAt: { gte: startOfFY, lte: endOfFY }
                },
                orderBy: { createdAt: 'asc' }, // Ascending for running balance
                include: {
                    project: { select: { name: true } }
                }
            });
        }
        let runningBalance = 0;
        const ledgerEntries = logs.map(log => {
            const isOut = log.transactionType === 'OUT';
            const piecesOut = isOut ? (log.quantityProduced || 0) : 0;
            const piecesIn = !isOut ? (log.quantityProduced || 0) : 0;
            runningBalance = runningBalance + piecesOut - piecesIn; // +Out -In
            return {
                ...log,
                id: log.id,
                date: log.createdAt,
                narration: `${isOut ? 'OUT' : 'IN'} - ${log.stage || 'General'} - ${log.productName || 'Product'}`,
                stage: log.stage,
                vehicleNumber: log.vehicleNumber || '-',
                piecesOut,
                piecesIn,
                balance: runningBalance,
                transactionType: log.transactionType,
                rawLog: log
            };
        });
        fastCache_1.fastCache.set(cacheKey, ledgerEntries, 120);
        res.json(ledgerEntries);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch vendor ledger' });
    }
});
// Create vendor
router.post('/', async (req, res) => {
    try {
        const { name, contact, address, services } = req.body;
        const vendor = await index_1.prisma.vendor.create({
            data: { name, contact, address, services }
        });
        fastCache_1.fastCache.invalidate('vendors_stats');
        res.status(201).json(vendor);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create vendor' });
    }
});
// Update vendor
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, contact, address, services, status } = req.body;
        const vendor = await index_1.prisma.vendor.update({
            where: { id },
            data: { name, contact, address, services, status }
        });
        fastCache_1.fastCache.invalidate('vendors_stats');
        fastCache_1.fastCache.invalidate(`vendor_ledger_${id}`);
        res.json(vendor);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update vendor' });
    }
});
// Delete (soft delete) vendor
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await index_1.prisma.vendor.update({
            where: { id },
            data: { status: 'inactive' }
        });
        fastCache_1.fastCache.invalidate('vendors_stats');
        fastCache_1.fastCache.invalidate(`vendor_ledger_${id}`);
        res.json({ success: true });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete vendor' });
    }
});
exports.default = router;
//# sourceMappingURL=vendorRoutes.js.map