"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const index_1 = require("../index");
const router = (0, express_1.Router)();
router.get('/ping', (req, res) => res.json({ status: 'pong', message: 'Backend is alive and responding instantly.' }));
router.get('/diagnostics', async (req, res) => {
    let outboundIp = 'unknown';
    try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        outboundIp = ipData.ip;
    }
    catch (e) {
        outboundIp = 'error: ' + e.message;
    }
    const dbUrl = process.env.DATABASE_URL;
    const dbConfigured = !!dbUrl;
    const dbType = dbUrl ? (dbUrl.startsWith('mongodb') ? 'MongoDB Atlas' : 'Other') : 'MISSING';
    let dbStatus = 'testing';
    let dbError = null;
    let elapsed = 0;
    try {
        const start = Date.now();
        const testQuery = Promise.race([
            index_1.prisma.user.findFirst({ select: { id: true } }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DATABASE_CONNECTION_TIMEOUT_5_SECONDS')), 5000))
        ]);
        await testQuery;
        elapsed = Date.now() - start;
        dbStatus = 'CONNECTED_OK';
    }
    catch (err) {
        dbStatus = 'FAILED';
        dbError = err.message;
    }
    res.json({
        serverOutboundIp: outboundIp,
        dbConfigured,
        dbType,
        dbStatus,
        dbError,
        elapsedMs: elapsed,
        nodeEnv: process.env.NODE_ENV
    });
});
// Register a new user
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, department, wage, otRate, staffId, modulesAccess } = req.body;
        const finalEmail = email || (staffId ? `${staffId}@unnati.com` : `${name.replace(/\s+/g, '').toLowerCase()}${Math.floor(Math.random() * 1000)}@unnati.com`);
        // Check if user exists by email or staffId
        const existingUser = await index_1.prisma.user.findFirst({
            where: {
                OR: [
                    { email: finalEmail },
                    ...(staffId ? [{ staffId }] : [])
                ]
            }
        });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists with this email or Staff ID' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const user = await index_1.prisma.user.create({
            data: {
                staffId,
                name,
                email: finalEmail,
                password: hashedPassword,
                role: role || 'employee',
                department,
                wage: wage ? parseFloat(wage) : 0,
                otRate: otRate ? parseFloat(otRate) : 0,
                modulesAccess: modulesAccess || [],
            },
        });
        res.status(201).json({ message: 'User created successfully', user });
    }
    catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});
// Login
router.post('/login', async (req, res) => {
    try {
        const { email: emailOrStaffId, password } = req.body;
        console.log('Login attempt for:', emailOrStaffId);
        const cleanInput = (emailOrStaffId || '').trim();
        // Fast indexed path: Exact match on unique indexed fields (email, staffId, name)
        const capitalizedInput = cleanInput.length > 0 ? (cleanInput.charAt(0).toUpperCase() + cleanInput.slice(1).toLowerCase()) : cleanInput;
        let user = await index_1.prisma.user.findFirst({
            where: {
                OR: [
                    { email: cleanInput },
                    { staffId: cleanInput },
                    { email: cleanInput.toLowerCase() },
                    { name: cleanInput },
                    { name: cleanInput.toLowerCase() },
                    { name: capitalizedInput }
                ]
            }
        });
        // Fallback path: Case-insensitive search if exact lookup returned null
        if (!user) {
            user = await index_1.prisma.user.findFirst({
                where: {
                    OR: [
                        { email: { equals: cleanInput, mode: 'insensitive' } },
                        { staffId: { equals: cleanInput, mode: 'insensitive' } },
                        { name: { equals: cleanInput, mode: 'insensitive' } }
                    ]
                }
            });
        }
        console.log('User found:', user ? user.email : 'None');
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const isMatch = await bcryptjs_1.default.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                modulesAccess: user.modulesAccess,
            },
        });
    }
    catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});
exports.default = router;
//# sourceMappingURL=authRoutes.js.map