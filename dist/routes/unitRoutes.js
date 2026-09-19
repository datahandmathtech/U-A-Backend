"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const index_1 = require("../index");
const fastCache_1 = require("../utils/fastCache");
const router = express_1.default.Router();
router.get('/', async (req, res) => {
    try {
        const cached = fastCache_1.fastCache.get('all_units');
        if (cached)
            return res.json(cached);
        let units = [];
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db && mongoose.connection.readyState === 1) {
            try {
                const raw = await db.collection('UnitCategory').find({}).sort({ name: 1 }).toArray();
                units = raw.map((u) => ({
                    id: u._id.toString(),
                    name: u.name,
                    createdAt: u.createdAt,
                    updatedAt: u.updatedAt
                }));
            }
            catch (err) {
                console.warn('Mongoose unit query failed:', err);
            }
        }
        if (units.length === 0) {
            units = await index_1.prisma.unitCategory.findMany({
                orderBy: { name: 'asc' }
            });
        }
        fastCache_1.fastCache.set('all_units', units, 300);
        res.json(units);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching units' });
    }
});
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name)
            return res.status(400).json({ message: 'Name is required' });
        // Check if exists
        const existing = await index_1.prisma.unitCategory.findUnique({ where: { name } });
        if (existing) {
            return res.json(existing);
        }
        const unit = await index_1.prisma.unitCategory.create({
            data: { name }
        });
        fastCache_1.fastCache.invalidate('all_units');
        res.status(201).json(unit);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating unit' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await index_1.prisma.unitCategory.delete({
            where: { id: String(id) }
        });
        fastCache_1.fastCache.invalidate('all_units');
        res.json({ message: 'Unit deleted' });
    }
    catch (error) {
        res.status(500).json({ message: 'Server error deleting unit' });
    }
});
exports.default = router;
//# sourceMappingURL=unitRoutes.js.map