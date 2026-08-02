import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
export const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

import authRoutes from './routes/authRoutes';
import leadRoutes from './routes/leadRoutes';
import projectRoutes from './routes/projectRoutes';
import designRoutes from './routes/designRoutes';
import quotationRoutes from './routes/quotationRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import productionRoutes from './routes/productionRoutes';
import categoryRoutes from './routes/categoryRoutes';
import unitRoutes from './routes/unitRoutes';
import machineRoutes from './routes/machineRoutes';
import dispatchRoutes from './routes/dispatchRoutes';
import hrRoutes from './routes/hrRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import qaRoutes from './routes/qaRoutes';
import laborRoutes from './routes/laborRoutes';
import machineLogRoutes from './routes/machineLogRoutes';
import expenseRoutes from './routes/expenseRoutes';
import electricityRoutes from './routes/electricityRoutes';
import closureRoutes from './routes/closureRoutes';
import liveFeedRoutes from './routes/liveFeedRoutes';
import uploadRoutes from './routes/uploadRoutes';
import drawingRoutes from './routes/drawingRoutes';
import slabRoutes from './routes/slabRoutes';
import vendorRoutes from './routes/vendorRoutes';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/designs', designRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/machines', machineRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/labor', laborRoutes);
app.use('/api/machine-logs', machineLogRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/slabs', slabRoutes);
app.use('/api/electricity', electricityRoutes);
app.use('/api/closure', closureRoutes);
app.use('/api/live-feed', liveFeedRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/drawings', drawingRoutes);
app.use('/api/vendors', vendorRoutes);

// Basic Route
app.get('/api/health', async (req, res) => {
  try {
    // Check database connectivity
    await prisma.user.count();
    res.json({ 
      status: 'ok', 
      message: 'Unnati ERP API is running and database is connected successfully.' 
    });
  } catch (error: any) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Unnati ERP API is running, but database connection failed.',
      error: error.message || error
    });
  }
});

// Serve static files from the frontend dist folder
app.use(express.static(path.join(__dirname, '../dist')));

// Catch-all route to serve the frontend app (Express 5 safe)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

import { initCronJobs } from './utils/cronJobs';

// Start Server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  initCronJobs();
  console.log('Cron jobs initialized');
});
