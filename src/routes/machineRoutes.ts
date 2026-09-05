import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Get machines
router.get('/', authenticate, async (req, res) => {
  try {
    const machines = await prisma.machine.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(machines);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching machines' });
  }
});

// Add machine
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, type, hourlyCost, maintenanceIntervalHours } = req.body;
    
    const newMachine = await prisma.machine.create({
      data: {
        name,
        type,
        hourlyCost: Number(hourlyCost),
        maintenanceIntervalHours: Number(maintenanceIntervalHours) || 200,
        status: 'active'
      }
    });
    
    res.status(201).json(newMachine);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating machine' });
  }
});

// Update Machine (e.g. reset maintenance hours)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, status, hourlyCost, maintenanceIntervalHours, totalRunHours } = req.body;
    
    const updated = await prisma.machine.update({
      where: { id: String(id) },
      data: {
        name, type, status, 
        hourlyCost: hourlyCost ? Number(hourlyCost) : undefined,
        maintenanceIntervalHours: maintenanceIntervalHours ? Number(maintenanceIntervalHours) : undefined,
        totalRunHours: totalRunHours !== undefined ? Number(totalRunHours) : undefined
      }
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating machine' });
  }
});

// Delete Machine
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const machineId = String(id);

    const machine = await prisma.machine.findUnique({
      where: { id: machineId }
    });

    if (!machine) {
      return res.status(404).json({ message: 'Machine not found or already deleted' });
    }

    // Cascade / Unlink relations safely
    await Promise.allSettled([
      prisma.machineLog.deleteMany({ where: { machineId } }),
      prisma.pieceLog.updateMany({ where: { machineId }, data: { machineId: null } }),
      prisma.productionLog.updateMany({ where: { machineId }, data: { machineId: null } }),
      prisma.attendance.updateMany({ where: { machineId }, data: { machineId: null } })
    ]);

    await prisma.machine.delete({ where: { id: machineId } });
    res.json({ message: 'Machine deleted successfully' });
  } catch (error: any) {
    console.error('Server error deleting machine:', error);
    res.status(500).json({ message: 'Server error deleting machine', error: error?.message || error });
  }
});

export default router;
