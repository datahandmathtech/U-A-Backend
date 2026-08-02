"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const router = (0, express_1.Router)();
// Get attendances
router.get('/attendance', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const records = await index_1.prisma.attendance.findMany({
            orderBy: { date: 'desc' },
            include: { user: { select: { name: true, department: true } } }
        });
        res.json(records);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching attendance' });
    }
});
// Mark Attendance (Check-in / Punch In)
router.post('/attendance/checkin', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { gpsLocation, photoUrl, machineId } = req.body;
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ message: 'Unauthorized' });
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        // Check if there is already an active session (to prevent double punch-in without punch-out)
        const existingActiveSession = await index_1.prisma.attendance.findFirst({
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
            }
            else {
                // Auto-close prior day attendance session at checkIn + 8 hours
                const autoCheckoutTime = new Date(new Date(existingActiveSession.checkIn).getTime() + 8 * 60 * 60 * 1000);
                await index_1.prisma.attendance.update({
                    where: { id: existingActiveSession.id },
                    data: { checkOut: autoCheckoutTime }
                });
            }
        }
        const newRecord = await index_1.prisma.attendance.create({
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error creating attendance' });
    }
});
// Mark Attendance (Check-out / Punch Out)
router.post('/attendance/checkout', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ message: 'Unauthorized' });
        // Find the latest attendance record for today that hasn't been checked out
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const activeSession = await index_1.prisma.attendance.findFirst({
            where: {
                userId,
                checkIn: { gte: startOfDay },
                checkOut: { isSet: false }
            },
            orderBy: { checkIn: 'desc' }
        });
        // Fallback if isSet: false is not supported or if checkOut was explicitly set to null
        const activeSessionFallback = activeSession || await index_1.prisma.attendance.findFirst({
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
        const updatedRecord = await index_1.prisma.attendance.update({
            where: { id: activeSessionFallback.id },
            data: { checkOut: new Date() }
        });
        res.json(updatedRecord);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error updating attendance' });
    }
});
// Get active session for user
router.get('/attendance/active', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ message: 'Unauthorized' });
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        let activeSession = await index_1.prisma.attendance.findFirst({
            where: {
                userId,
                checkIn: { gte: startOfDay },
                checkOut: { isSet: false }
            },
            orderBy: { checkIn: 'desc' },
            include: { machine: true }
        });
        if (!activeSession) {
            activeSession = await index_1.prisma.attendance.findFirst({
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching active attendance' });
    }
});
// Get staff salary calculation
router.get('/staff-salary', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const users = await index_1.prisma.user.findMany({
            where: { role: 'worker' },
            select: {
                id: true,
                name: true,
                department: true,
                wage: true,
                otRate: true,
                pieceRate: true,
                attendances: {
                    where: { checkOut: { not: null } }
                },
                productionLogs: {
                    where: { status: 'completed' }
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
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching staff salary' });
    }
});
// Update staff
router.put('/staff/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        const { name, staffId, role, department, password } = req.body;
        // Check if user exists
        const user = await index_1.prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ message: 'Staff member not found' });
        }
        const dataToUpdate = {
            name,
            staffId: staffId && staffId.trim() !== '' ? staffId : null,
            role,
            department
        };
        if (password && password.trim() !== '') {
            dataToUpdate.password = await bcryptjs_1.default.hash(password, 10);
        }
        const updatedUser = await index_1.prisma.user.update({
            where: { id },
            data: dataToUpdate
        });
        res.json({ message: 'Staff member updated successfully', user: { id: updatedUser.id, name: updatedUser.name } });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error updating staff' });
    }
});
// Delete staff
router.delete('/staff/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const id = req.params.id;
        // Check if user exists
        const user = await index_1.prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({ message: 'Staff member not found' });
        }
        // Delete related records to maintain DB integrity
        await index_1.prisma.attendance.deleteMany({ where: { userId: id } });
        await index_1.prisma.productionLog.deleteMany({ where: { workerId: id } });
        await index_1.prisma.machineLog.deleteMany({ where: { operatorId: id } });
        await index_1.prisma.payroll.deleteMany({ where: { userId: id } });
        // Delete the user
        await index_1.prisma.user.delete({ where: { id } });
        res.json({ message: 'Staff member deleted successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error deleting staff' });
    }
});
// Get all staff (for management)
router.get('/staff', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const users = await index_1.prisma.user.findMany({
            select: { id: true, name: true, email: true, staffId: true, role: true, department: true }
        });
        res.json(users);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching staff' });
    }
});
exports.default = router;
//# sourceMappingURL=hrRoutes.js.map