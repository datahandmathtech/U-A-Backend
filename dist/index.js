"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const client_1 = require("@prisma/client");
dotenv_1.default.config();
const standardUri = 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?ssl=true&replicaSet=atlas-icn4hi-shard-0&authSource=admin&retryWrites=true&w=majority&readPreference=primaryPreferred&connectTimeoutMS=10000&socketTimeoutMS=20000&serverSelectionTimeoutMS=5000&maxIdleTimeMS=10000';
let effectiveDbUrl = process.env.DATABASE_URL || process.env.MONGO_URI || standardUri;
// If env var is missing or contains old SRV string, use the resilient direct replica set URI
if (!effectiveDbUrl || effectiveDbUrl.startsWith('mongodb+srv://') || effectiveDbUrl.includes('cluster0.') || effectiveDbUrl.includes('maxPoolSize') || !effectiveDbUrl.includes('serverSelectionTimeoutMS')) {
    effectiveDbUrl = standardUri;
}
process.env.DATABASE_URL = effectiveDbUrl;
process.env.MONGO_URI = effectiveDbUrl;
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ||
    new client_1.PrismaClient({
        datasources: {
            db: {
                url: effectiveDbUrl
            }
        }
    });
globalForPrisma.prisma = exports.prisma;
const mongoose_1 = __importDefault(require("mongoose"));
mongoose_1.default.connect(effectiveDbUrl).then(() => {
    console.log('MongoDB (Mongoose) connected successfully');
}).catch((err) => {
    console.error('MongoDB connection error:', err.message);
});
// Middleware
app.use((0, compression_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const leadRoutes_1 = __importDefault(require("./routes/leadRoutes"));
const projectRoutes_1 = __importDefault(require("./routes/projectRoutes"));
const designRoutes_1 = __importDefault(require("./routes/designRoutes"));
const quotationRoutes_1 = __importDefault(require("./routes/quotationRoutes"));
const invoiceRoutes_1 = __importDefault(require("./routes/invoiceRoutes"));
const inventoryRoutes_1 = __importDefault(require("./routes/inventoryRoutes"));
const productionRoutes_1 = __importDefault(require("./routes/productionRoutes"));
const categoryRoutes_1 = __importDefault(require("./routes/categoryRoutes"));
const unitRoutes_1 = __importDefault(require("./routes/unitRoutes"));
const machineRoutes_1 = __importDefault(require("./routes/machineRoutes"));
const dispatchRoutes_1 = __importDefault(require("./routes/dispatchRoutes"));
const hrRoutes_1 = __importDefault(require("./routes/hrRoutes"));
const dashboardRoutes_1 = __importDefault(require("./routes/dashboardRoutes"));
const qaRoutes_1 = __importDefault(require("./routes/qaRoutes"));
const laborRoutes_1 = __importDefault(require("./routes/laborRoutes"));
const machineLogRoutes_1 = __importDefault(require("./routes/machineLogRoutes"));
const expenseRoutes_1 = __importDefault(require("./routes/expenseRoutes"));
const electricityRoutes_1 = __importDefault(require("./routes/electricityRoutes"));
const closureRoutes_1 = __importDefault(require("./routes/closureRoutes"));
const liveFeedRoutes_1 = __importDefault(require("./routes/liveFeedRoutes"));
const uploadRoutes_1 = __importDefault(require("./routes/uploadRoutes"));
const drawingRoutes_1 = __importDefault(require("./routes/drawingRoutes"));
const slabRoutes_1 = __importDefault(require("./routes/slabRoutes"));
const vendorRoutes_1 = __importDefault(require("./routes/vendorRoutes"));
const wasteRoutes_1 = __importDefault(require("./routes/wasteRoutes"));
const packingRoutes_1 = __importDefault(require("./routes/packingRoutes"));
// TCP/TLS Test route for Hostinger Support
app.get('/api/test-tcp', (req, res) => {
    const tls = require('tls');
    const targetHost = 'ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net';
    let logs = [];
    const start = Date.now();
    logs.push(`Starting TLS connection test to ${targetHost}:27017...`);
    const socket = tls.connect({ host: targetHost, port: 27017, servername: targetHost, timeout: 10000 }, () => {
        logs.push(`SUCCESS: TLS connection established to ${targetHost} after ${Date.now() - start}ms`);
        socket.destroy();
        res.json({ status: 'success', logs, timeMs: Date.now() - start });
    });
    socket.on('timeout', () => {
        logs.push(`TIMEOUT: TLS connection timed out after ${Date.now() - start}ms`);
        socket.destroy();
        res.json({ status: 'timeout', logs, timeMs: Date.now() - start });
    });
    socket.on('error', (err) => {
        logs.push(`ERROR: TLS connection failed with error: ${err.message}`);
        res.json({ status: 'error', logs, error: err.message, timeMs: Date.now() - start });
    });
});
app.get('/api/test-login-hang', async (req, res) => {
    const start = Date.now();
    let step = 'start';
    try {
        const bcrypt = require('bcryptjs');
        const { prisma } = require('./index');
        step = 'query1';
        const user = await prisma.user.findFirst({
            where: { email: 'admin@unnati.com' }
        });
        const t1 = Date.now() - start;
        step = 'bcrypt';
        const isMatch = await bcrypt.compare('wrong', user ? user.password : 'dummy');
        const t2 = Date.now() - start - t1;
        res.json({ success: true, userEmail: user?.email, queryTime: t1, bcryptTime: t2, totalTime: Date.now() - start });
    }
    catch (e) {
        res.json({ success: false, failedAt: step, error: e.message, totalTime: Date.now() - start });
    }
});
// Routes
const mountRoutes = (prefix = '') => {
    app.use([`${prefix}/auth`, `${prefix}/user-auth`, `${prefix}/session`, `${prefix}/account`], authRoutes_1.default);
    app.use(`${prefix}/leads`, leadRoutes_1.default);
    app.use(`${prefix}/projects`, projectRoutes_1.default);
    app.use(`${prefix}/designs`, designRoutes_1.default);
    app.use(`${prefix}/quotations`, quotationRoutes_1.default);
    app.use(`${prefix}/invoices`, invoiceRoutes_1.default);
    app.use(`${prefix}/inventory`, inventoryRoutes_1.default);
    app.use(`${prefix}/machines`, machineRoutes_1.default);
    app.use(`${prefix}/production`, productionRoutes_1.default);
    app.use(`${prefix}/categories`, categoryRoutes_1.default);
    app.use(`${prefix}/units`, unitRoutes_1.default);
    app.use(`${prefix}/dispatch`, dispatchRoutes_1.default);
    app.use(`${prefix}/hr`, hrRoutes_1.default);
    app.use(`${prefix}/dashboard`, dashboardRoutes_1.default);
    app.use(`${prefix}/qa`, qaRoutes_1.default);
    app.use(`${prefix}/labor`, laborRoutes_1.default);
    app.use(`${prefix}/machine-logs`, machineLogRoutes_1.default);
    app.use(`${prefix}/expenses`, expenseRoutes_1.default);
    app.use(`${prefix}/slabs`, slabRoutes_1.default);
    app.use(`${prefix}/electricity`, electricityRoutes_1.default);
    app.use(`${prefix}/closure`, closureRoutes_1.default);
    app.use(`${prefix}/live-feed`, liveFeedRoutes_1.default);
    app.use(`${prefix}/upload`, uploadRoutes_1.default);
    app.use(`${prefix}/drawings`, drawingRoutes_1.default);
    app.use(`${prefix}/slabs`, slabRoutes_1.default);
    app.use(`${prefix}/vendors`, vendorRoutes_1.default);
    app.use(`${prefix}/waste`, wasteRoutes_1.default);
    app.use(`${prefix}/packing-items`, packingRoutes_1.default);
};
mountRoutes('/api');
// Debug Mongo Route
app.get('/api/debug-mongo', async (req, res) => {
    const results = { time: new Date().toISOString() };
    // 1. Get Outbound IP
    try {
        const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
        const ipJson = await ipRes.json();
        results.serverOutboundIp = ipJson.ip;
    }
    catch (e) {
        results.serverOutboundIp = 'Could not fetch IP: ' + e.message;
    }
    // 2. Test native Mongoose/MongoDB connection
    try {
        const mongoose = require('mongoose');
        const startM = Date.now();
        const conn = await mongoose.createConnection(effectiveDbUrl, { serverSelectionTimeoutMS: 4000 }).asPromise();
        results.mongooseTimeMs = Date.now() - startM;
        const collections = await conn.db.listCollections().toArray();
        results.collectionsCount = collections.length;
        results.collections = collections.map((c) => c.name);
        await conn.close();
        results.mongooseStatus = 'SUCCESS';
    }
    catch (mErr) {
        results.mongooseStatus = 'FAILED: ' + mErr.message;
    }
    // 3. Test Prisma query with timeout
    try {
        const startP = Date.now();
        const count = await Promise.race([
            exports.prisma.user.count(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Prisma count timeout after 12000ms')), 12000))
        ]);
        results.prismaTimeMs = Date.now() - startP;
        results.prismaUserCount = count;
        results.prismaStatus = 'SUCCESS';
    }
    catch (pErr) {
        results.prismaStatus = 'FAILED: ' + pErr.message;
    }
    res.json(results);
});
// Ping & Health Routes
app.get(['/api/ping', '/ping'], (req, res) => {
    const maskedUrl = (effectiveDbUrl || '').replace(/:([^:@]+)@/, ':****@');
    res.json({
        status: 'ok',
        version: 'v3.0-direct-replica',
        time: new Date().toISOString(),
        port,
        dbStatus: process.env.DATABASE_URL ? 'configured' : 'missing',
        dbUrl: maskedUrl
    });
});
app.get('/api/health', async (req, res) => {
    const start = Date.now();
    try {
        // Check database connectivity with 8 second timeout
        const userCount = await Promise.race([
            exports.prisma.user.count(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timed out after 8000ms')), 8000))
        ]);
        res.json({
            status: 'ok',
            message: 'Unnati ERP API is running and database is connected successfully.',
            userCount,
            responseTimeMs: Date.now() - start
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Unnati ERP API is running, but database connection failed.',
            error: error.message || error,
            responseTimeMs: Date.now() - start
        });
    }
});
// Static file caching headers (immutable caching for hashed assets, no-cache for index.html)
const staticOptions = {
    maxAge: '30d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
        else if (filePath.includes(path_1.default.sep + 'assets' + path_1.default.sep) || filePath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
};
// Serve static files from public directory
app.use(express_1.default.static(path_1.default.join(__dirname, '../public'), staticOptions));
// Catch-all route
app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.headers.accept?.includes('application/json')) {
        res.status(404).json({ error: 'API endpoint not found: ' + req.path });
    }
    else {
        const publicIndexPath = path_1.default.join(__dirname, '../public/index.html');
        const rootIndexPath = path_1.default.join(__dirname, '../index.html');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        if (fs_1.default.existsSync(publicIndexPath)) {
            res.sendFile(publicIndexPath);
        }
        else if (fs_1.default.existsSync(rootIndexPath)) {
            res.sendFile(rootIndexPath);
        }
        else {
            res.status(404).send('Not Found: Frontend files are missing. Please copy the frontend build to the backend/public folder.');
        }
    }
});
const cronJobs_1 = require("./utils/cronJobs");
// Start Server
app.listen(Number(port), '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
    (0, cronJobs_1.initCronJobs)();
    console.log('Cron jobs initialized');
});
//# sourceMappingURL=index.js.map