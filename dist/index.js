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
const client_1 = require("@prisma/client");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
exports.prisma = new client_1.PrismaClient();
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
// Routes
app.use('/api/auth', authRoutes_1.default);
app.use('/api/leads', leadRoutes_1.default);
app.use('/api/projects', projectRoutes_1.default);
app.use('/api/designs', designRoutes_1.default);
app.use('/api/quotations', quotationRoutes_1.default);
app.use('/api/invoices', invoiceRoutes_1.default);
app.use('/api/inventory', inventoryRoutes_1.default);
app.use('/api/machines', machineRoutes_1.default);
app.use('/api/production', productionRoutes_1.default);
app.use('/api/categories', categoryRoutes_1.default);
app.use('/api/units', unitRoutes_1.default);
app.use('/api/dispatch', dispatchRoutes_1.default);
app.use('/api/hr', hrRoutes_1.default);
app.use('/api/dashboard', dashboardRoutes_1.default);
app.use('/api/qa', qaRoutes_1.default);
app.use('/api/labor', laborRoutes_1.default);
app.use('/api/machine-logs', machineLogRoutes_1.default);
app.use('/api/expenses', expenseRoutes_1.default);
app.use('/api/slabs', slabRoutes_1.default);
app.use('/api/electricity', electricityRoutes_1.default);
app.use('/api/closure', closureRoutes_1.default);
app.use('/api/live-feed', liveFeedRoutes_1.default);
app.use('/api/upload', uploadRoutes_1.default);
app.use('/api/drawings', drawingRoutes_1.default);
app.use('/api/vendors', vendorRoutes_1.default);
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
// Serve static files from the frontend dist folder
app.use(express_1.default.static(path_1.default.join(__dirname, '../dist')));
// Catch-all route to serve the frontend app (Express 5 safe)
app.use((req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../dist/index.html'));
});
const cronJobs_1 = require("./utils/cronJobs");
// Start Server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    (0, cronJobs_1.initCronJobs)();
    console.log('Cron jobs initialized');
});
//# sourceMappingURL=index.js.map