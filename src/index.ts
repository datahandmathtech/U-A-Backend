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
const mountRoutes = (prefix = '') => {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/leads`, leadRoutes);
  app.use(`${prefix}/projects`, projectRoutes);
  app.use(`${prefix}/designs`, designRoutes);
  app.use(`${prefix}/quotations`, quotationRoutes);
  app.use(`${prefix}/invoices`, invoiceRoutes);
  app.use(`${prefix}/inventory`, inventoryRoutes);
  app.use(`${prefix}/machines`, machineRoutes);
  app.use(`${prefix}/production`, productionRoutes);
  app.use(`${prefix}/categories`, categoryRoutes);
  app.use(`${prefix}/units`, unitRoutes);
  app.use(`${prefix}/dispatch`, dispatchRoutes);
  app.use(`${prefix}/hr`, hrRoutes);
  app.use(`${prefix}/dashboard`, dashboardRoutes);
  app.use(`${prefix}/qa`, qaRoutes);
  app.use(`${prefix}/labor`, laborRoutes);
  app.use(`${prefix}/machine-logs`, machineLogRoutes);
  app.use(`${prefix}/expenses`, expenseRoutes);
  app.use(`${prefix}/slabs`, slabRoutes);
  app.use(`${prefix}/electricity`, electricityRoutes);
  app.use(`${prefix}/closure`, closureRoutes);
  app.use(`${prefix}/live-feed`, liveFeedRoutes);
  app.use(`${prefix}/upload`, uploadRoutes);
  app.use(`${prefix}/drawings`, drawingRoutes);
  app.use(`${prefix}/vendors`, vendorRoutes);
};

mountRoutes('/api');
mountRoutes(''); // Support proxies that strip the /api prefix

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

import fs from 'fs';

// Serve static files from the 'public' folder (you need to copy frontend dist here on live server)
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all route
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ error: 'API endpoint not found: ' + req.path });
  } else {
    const indexPath = path.join(__dirname, '../public/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Not Found: Frontend files are missing. Please copy the frontend build to the backend/public folder.');
    }
  }
});

import { initCronJobs } from './utils/cronJobs';

// Start Server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  initCronJobs();
  console.log('Cron jobs initialized');
});
