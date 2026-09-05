import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import bcrypt from 'bcryptjs';

const router = Router();

// Get attendances
router.get('/attendance', authenticate, async (req, res) => {
  try {
    const records = await prisma.attendance.findMany({
      orderBy: { date: 'desc' },
      include: { user: { select: { name: true, department: true } } }
    });
    res.json(records);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error fetching attendance' });
  }
});

// Mark Attendance (Check-in / Punch In)
router.post('/attendance/checkin', authenticate, async (req, res) => {
  try {
    const { gpsLocation, photoUrl, machineId } = req.body;
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Check if there is already an active session (to prevent double punch-in without punch-out)
    const existingActiveSession = await prisma.attendance.findFirst({
      where: { 
        userId,
        OR: [
          { checkOut: { isSet: false } },
          { checkOut: null }
        ]
      }
    });

    if (existingActiveSession) {
      if (new Date(existingActiveSession.checkIn) >= startOfDay) {
        return res.status(400).json({ message: 'You are already punched in. Please punch out first.' });
      } else {
        // Auto-close prior day attendance session at checkIn + 8 hours
        const autoCheckoutTime = new Date(new Date(existingActiveSession.checkIn).getTime() + 8 * 60 * 60 * 1000);
        await prisma.attendance.update({
          where: { id: existingActiveSession.id },
          data: { checkOut: autoCheckoutTime }
        });
      }
    }

    const newRecord = await prisma.attendance.create({
      data: {
        userId,
        checkIn: new Date(),
        gpsLocation,
        photoUrl,
        machineId: machineId || null,
        status: 'present'
      }
    });
    
    res.status(201).json(newRecord);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error creating attendance' });
  }
});

// Mark Attendance (Check-out / Punch Out)
router.post('/attendance/checkout', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Find the latest attendance record for today that hasn't been checked out
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const activeSession = await prisma.attendance.findFirst({
      where: { 
        userId, 
        checkIn: { gte: startOfDay },
        checkOut: { isSet: false }
      },
      orderBy: { checkIn: 'desc' }
    });

    // Fallback if isSet: false is not supported or if checkOut was explicitly set to null
    const activeSessionFallback = activeSession || await prisma.attendance.findFirst({
      where: { 
        userId, 
        checkIn: { gte: startOfDay },
        checkOut: null
      },
      orderBy: { checkIn: 'desc' }
    });

    if (!activeSessionFallback) {
      return res.status(400).json({ message: 'No active punch-in found to check out.' });
    }

    const updatedRecord = await prisma.attendance.update({
      where: { id: activeSessionFallback.id },
      data: { checkOut: new Date() }
    });
    
    res.json(updatedRecord);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error updating attendance' });
  }
});

// Get active session for user
router.get('/attendance/active', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let activeSession = await prisma.attendance.findFirst({
      where: { 
        userId, 
        checkIn: { gte: startOfDay },
        checkOut: { isSet: false } 
      },
      orderBy: { checkIn: 'desc' },
      include: { machine: true }
    });

    if (!activeSession) {
      activeSession = await prisma.attendance.findFirst({
        where: { 
          userId, 
          checkIn: { gte: startOfDay },
          checkOut: null 
        },
        orderBy: { checkIn: 'desc' },
        include: { machine: true }
      });
    }

    res.json(activeSession || null);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error fetching active attendance' });
  }
});

// Admin Manual Attendance Entry
router.post('/attendance/manual', authenticate, async (req, res) => {
  try {
    const { userId, checkIn, checkOut, date } = req.body;
    
    // Validate inputs
    if (!userId || !checkIn) {
      return res.status(400).json({ message: 'User and Check-In time are required' });
    }

    const newRecord = await prisma.attendance.create({
      data: {
        userId,
        date: date ? new Date(date) : new Date(checkIn),
        checkIn: new Date(checkIn),
        checkOut: checkOut ? new Date(checkOut) : null,
        status: 'present',
        gpsLocation: 'Manual Admin Entry'
      }
    });
    
    res.status(201).json(newRecord);
  } catch (error) { 
    console.error(error);
    res.status(500).json({ message: 'Server error creating manual attendance' });
  }
});

// Get staff salary calculation
router.get('/staff-salary', authenticate, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'worker' },
      select: {
        id: true,
        name: true,
        department: true,
        wage: true,
        otRate: true,
        pieceRate: true,
        attendances: {
          where: { checkOut: { not: null } },
          select: { checkIn: true, checkOut: true }
        },
        productionLogs: {
          where: { status: 'completed' },
          select: { quantityProduced: true }
        }
      }
    });

    const staffData = users.map(user => {
      // Basic piece rate calculation
      const totalSqFt = user.productionLogs.reduce((acc, log) => acc + (log.quantityProduced || 0), 0);
      const pieceRateEarnings = totalSqFt * (user.pieceRate || 0);
      
      // Basic time-based calculation (simplified)
      let totalHours = 0;
      user.attendances.forEach(att => {
        if (att.checkIn && att.checkOut) {
          totalHours += (new Date(att.checkOut).getTime() - new Date(att.checkIn).getTime()) / (1000 * 60 * 60);
        }
      });
      const hourlyEarnings = totalHours * ((user.wage || 0) / 8); // Assuming wage is daily for 8 hours

      return {
        ...user,
        totalSqFt,
        totalHours: totalHours.toFixed(2),
        estimatedSalary: pieceRateEarnings > 0 ? pieceRateEarnings : hourlyEarnings
      };
    });

    res.json(staffData);
  } catch (error) { console.error(error);
    res.status(500).json({ message: 'Server error fetching staff salary' });
  }
});

// Update staff
router.put('/staff/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { name, staffId, role, department, password, modulesAccess } = req.body;
    
    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    const dataToUpdate: any = { 
      name, 
      staffId: staffId && staffId.trim() !== '' ? staffId : null, 
      role, 
      department,
      ...(modulesAccess !== undefined ? { modulesAccess } : {})
    };

    if (password && password.trim() !== '') {
      dataToUpdate.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
    });
    res.json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error updating staff' });
  }
});

// Delete staff
router.delete('/staff/:id', authenticate, async (req, res) => {
  try {
    const id = req.params.id as string;
    
    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Delete related records to maintain DB integrity
    await prisma.attendance.deleteMany({ where: { userId: id } });
    await prisma.productionLog.deleteMany({ where: { workerId: id } });
    await prisma.machineLog.deleteMany({ where: { operatorId: id } });
    await prisma.payroll.deleteMany({ where: { userId: id } });
    
    // Delete the user
    await prisma.user.delete({ where: { id } });

    res.json({ message: 'Staff member deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error deleting staff' });
  }
});

// Get all staff (for management)
router.get('/staff', authenticate, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, staffId: true, role: true, department: true, modulesAccess: true }
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching staff' });
  }
});

export default router;
