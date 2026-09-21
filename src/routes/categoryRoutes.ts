import express from 'express';
import { prisma } from '../index';
import { fastCache } from '../utils/fastCache';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const cached = fastCache.get('all_categories');
    if (cached) return res.json(cached);

    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const raw = await db.collection('ProductCategory').find({}).sort({ name: 1 }).toArray();
        const categories = raw.map((c: any) => ({ id: c._id.toString(), name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt }));
        fastCache.set('all_categories', categories, 300);
        return res.json(categories);
      } catch (mErr) {
        console.warn('Mongoose categories fetch failed:', mErr);
      }
    }

    const categories = await prisma.productCategory.findMany({
      orderBy: { name: 'asc' }
    });
    fastCache.set('all_categories', categories, 300);
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching categories' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });
    
    // Check if exists
    const existing = await prisma.productCategory.findUnique({ where: { name } });
    if (existing) {
      return res.json(existing);
    }

    const category = await prisma.productCategory.create({
      data: { name }
    });
    fastCache.invalidate('all_categories');
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating category' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.productCategory.delete({
      where: { id: String(id) }
    });
    fastCache.invalidate('all_categories');
    res.json({ message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting category' });
  }
});

export default router;
