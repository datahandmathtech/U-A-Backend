import express from 'express';
import { prisma } from '../index';
import { fastCache } from '../utils/fastCache';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const cached = fastCache.get('all_units');
    if (cached) return res.json(cached);

    let units: any[] = [];
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db && mongoose.connection.readyState === 1) {
      try {
        const raw = await db.collection('UnitCategory').find({}).sort({ name: 1 }).toArray();
        units = raw.map((u: any) => ({
          id: u._id.toString(),
          name: u.name,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt
        }));
        fastCache.set('all_units', units, 300);
        return res.json(units);
      } catch (err) {
        console.warn('Mongoose unit query failed, falling back to Prisma:', err);
      }
    }

    const prismaUnits = await prisma.unitCategory.findMany({
      orderBy: { name: 'asc' }
    });

    fastCache.set('all_units', prismaUnits, 300);
    res.json(prismaUnits);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching units' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });
    
    // Check if exists
    const existing = await prisma.unitCategory.findUnique({ where: { name } });
    if (existing) {
      return res.json(existing);
    }

    const unit = await prisma.unitCategory.create({
      data: { name }
    });
    fastCache.invalidate('all_units');
    res.status(201).json(unit);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating unit' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.unitCategory.delete({
      where: { id: String(id) }
    });
    fastCache.invalidate('all_units');
    res.json({ message: 'Unit deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting unit' });
  }
});

export default router;
