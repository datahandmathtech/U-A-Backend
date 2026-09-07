"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const client_1 = require("@prisma/client");
dotenv_1.default.config();
// Ensure the optimal MongoDB connection string with explicit timeout is always used on Hostinger
let effectiveDbUrl = process.env.DATABASE_URL || '';
if (!effectiveDbUrl || effectiveDbUrl.includes('iuq9w0n.mongodb.net') || effectiveDbUrl.includes('ac-n3u3fkt-shard')) {
    effectiveDbUrl = 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?replicaSet=atlas-icn4hi-shard-0&authSource=admin&ssl=true&connectTimeoutMS=5000&serverSelectionTimeoutMS=5000&retryWrites=true&w=majority';
    process.env.DATABASE_URL = effectiveDbUrl;
    process.env.MONGO_URI = effectiveDbUrl;
}
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
exports.prisma = new client_1.PrismaClient({
    datasources: {
        db: {
            url: effectiveDbUrl
        }
    }
});
// Eagerly connect to MongoDB to eliminate cold start delays
exports.prisma.$connect()
    .then(() => console.log('✅ MongoDB connected successfully via Prisma (SRV)'))
    .catch((err) => console.error('❌ MongoDB initial connection warning:', err?.message || err));
// Middleware
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
// Routes
const mountRoutes = (prefix = '') => {
    app.use(`${prefix}/auth`, authRoutes_1.default);
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
// Basic Route
app.get('/api/health', async (req, res) => {
    try {
        // Check database connectivity
        await exports.prisma.user.count();
        res.json({
            status: 'ok',
            message: 'Unnati ERP API is running and database is connected successfully.'
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Unnati ERP API is running, but database connection failed.',
            error: error.message || error
        });
    }
});
// Serve static files from multiple potential directories
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
app.use(express_1.default.static(path_1.default.join(__dirname, '../public_html')));
app.use(express_1.default.static(path_1.default.join(__dirname, '..')));
// Catch-all route
app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.headers.accept?.includes('application/json')) {
        res.status(404).json({ error: 'API endpoint not found: ' + req.path });
    }
    else {
        const publicIndexPath = path_1.default.join(__dirname, '../public/index.html');
        const publicHtmlIndexPath = path_1.default.join(__dirname, '../public_html/index.html');
        const rootIndexPath = path_1.default.join(__dirname, '../index.html');
        if (fs_1.default.existsSync(publicIndexPath)) {
            res.sendFile(publicIndexPath);
        }
        else if (fs_1.default.existsSync(publicHtmlIndexPath)) {
            res.sendFile(publicHtmlIndexPath);
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
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    (0, cronJobs_1.initCronJobs)();
    console.log('Cron jobs initialized');
});
//# sourceMappingURL=index.js.map