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
        const cached = fastCache_1.fastCache.get('all_categories');
        if (cached)
            return res.json(cached);
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const raw = await db.collection('ProductCategory').find({}).sort({ name: 1 }).toArray();
                const categories = raw.map((c) => ({ id: c._id.toString(), name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt }));
                fastCache_1.fastCache.set('all_categories', categories, 300);
                return res.json(categories);
            }
            catch (mErr) {
                console.warn('Mongoose categories fetch failed:', mErr);
            }
        }
        const categories = await index_1.prisma.productCategory.findMany({
            orderBy: { name: 'asc' }
        });
        fastCache_1.fastCache.set('all_categories', categories, 300);
        res.json(categories);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching categories' });
    }
});
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name)
            return res.status(400).json({ message: 'Name is required' });
        // Check if exists
        const existing = await index_1.prisma.productCategory.findUnique({ where: { name } });
        if (existing) {
            return res.json(existing);
        }
        const category = await index_1.prisma.productCategory.create({
            data: { name }
        });
        fastCache_1.fastCache.invalidate('all_categories');
        res.status(201).json(category);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating category' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await index_1.prisma.productCategory.delete({
            where: { id: String(id) }
        });
        fastCache_1.fastCache.invalidate('all_categories');
        res.json({ message: 'Category deleted' });
    }
    catch (error) {
        res.status(500).json({ message: 'Server error deleting category' });
    }
});
exports.default = router;
//# sourceMappingURL=categoryRoutes.js.map