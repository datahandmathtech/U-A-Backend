import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const standardUri = 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?ssl=true&replicaSet=atlas-icn4hi-shard-0&authSource=admin&retryWrites=true&w=majority&readPreference=primaryPreferred&connectTimeoutMS=10000&socketTimeoutMS=20000&serverSelectionTimeoutMS=5000&maxIdleTimeMS=10000';
let effectiveDbUrl = process.env.DATABASE_URL || process.env.MONGO_URI || standardUri;

// If env var is missing or contains old SRV string, use the resilient direct replica set URI
if (!effectiveDbUrl || effectiveDbUrl.startsWith('mongodb+srv://') || effectiveDbUrl.includes('cluster0.') || effectiveDbUrl.includes('maxPoolSize') || !effectiveDbUrl.includes('serverSelectionTimeoutMS')) {
  effectiveDbUrl = standardUri;
}

process.env.DATABASE_URL = effectiveDbUrl;
process.env.MONGO_URI = effectiveDbUrl;

const app = express();
const port = process.env.PORT || 5000;
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: effectiveDbUrl
      }
    }
  });

globalForPrisma.prisma = prisma;

import mongoose from 'mongoose';

// Middleware
app.use(compression());
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
import wasteRoutes from './routes/wasteRoutes';
import packingRoutes from './routes/packingRoutes';

// TCP/TLS Test route for Hostinger Support
app.get('/api/test-tcp', (req, res) => {
  const tls = require('tls');
  const targetHost = 'ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net';
  let logs = [];
  const start = Date.now();
  logs.push(`Starting TLS connection test to ${targetHost}:27017...`);
  
  const socket = tls.connect(
    { host: targetHost, port: 27017, servername: targetHost, timeout: 10000 },
    () => {
      logs.push(`SUCCESS: TLS connection established to ${targetHost} after ${Date.now() - start}ms`);
      socket.destroy();
      res.json({ status: 'success', logs, timeMs: Date.now() - start });
    }
  );

  socket.on('timeout', () => {
    logs.push(`TIMEOUT: TLS connection timed out after ${Date.now() - start}ms`);
    socket.destroy();
    res.json({ status: 'timeout', logs, timeMs: Date.now() - start });
  });

  socket.on('error', (err: any) => {
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
  } catch (e: any) {
    res.json({ success: false, failedAt: step, error: e.message, totalTime: Date.now() - start });
  }
});

// Routes
const mountRoutes = (prefix = '') => {
  app.use([`${prefix}/auth`, `${prefix}/user-auth`, `${prefix}/session`, `${prefix}/account`], authRoutes);
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
  app.use([`${prefix}/machine-logs`, `${prefix}/machine_logs`], machineLogRoutes);
  app.use(`${prefix}/expenses`, expenseRoutes);
  app.use(`${prefix}/slabs`, slabRoutes);
  app.use(`${prefix}/electricity`, electricityRoutes);
  app.use(`${prefix}/closure`, closureRoutes);
  app.use([`${prefix}/live-feed`, `${prefix}/live_feed`], liveFeedRoutes);
  app.use(`${prefix}/upload`, uploadRoutes);
  app.use(`${prefix}/drawings`, drawingRoutes);
  app.use(`${prefix}/slabs`, slabRoutes);
  app.use(`${prefix}/vendors`, vendorRoutes);
  app.use(`${prefix}/waste`, wasteRoutes);
  app.use([`${prefix}/packing-items`, `${prefix}/packing_items`], packingRoutes);
};

mountRoutes('/api');

// Debug Mongo Route
app.get('/api/debug-mongo', async (req, res) => {
  const results: any = { time: new Date().toISOString() };
  
  // 1. Get Outbound IP
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    const ipJson: any = await ipRes.json();
    results.serverOutboundIp = ipJson.ip;
  } catch (e: any) {
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
    results.collections = collections.map((c: any) => c.name);
    await conn.close();
    results.mongooseStatus = 'SUCCESS';
  } catch (mErr: any) {
    results.mongooseStatus = 'FAILED: ' + mErr.message;
  }

  // 3. Test Prisma query with timeout
  try {
    const startP = Date.now();
    const count = await Promise.race([
      prisma.user.count(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Prisma count timeout after 12000ms')), 12000))
    ]);
    results.prismaTimeMs = Date.now() - startP;
    results.prismaUserCount = count;
    results.prismaStatus = 'SUCCESS';
  } catch (pErr: any) {
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
      prisma.user.count(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timed out after 8000ms')), 8000))
    ]);
    res.json({ 
      status: 'ok', 
      message: 'Unnati ERP API is running and database is connected successfully.',
      userCount,
      responseTimeMs: Date.now() - start
    });
  } catch (error: any) {
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
  setHeaders: (res: express.Response, filePath: string) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.includes(path.sep + 'assets' + path.sep) || filePath.includes('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
};

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public'), staticOptions));

// Catch-all route
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ error: 'API endpoint not found: ' + req.path });
  } else {
    const publicIndexPath = path.join(__dirname, '../public/index.html');
    const rootIndexPath = path.join(__dirname, '../index.html');

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (fs.existsSync(publicIndexPath)) {
      res.sendFile(publicIndexPath);
    } else if (fs.existsSync(rootIndexPath)) {
      res.sendFile(rootIndexPath);
    } else {
      res.status(404).send('Not Found: Frontend files are missing. Please copy the frontend build to the backend/public folder.');
    }
  }
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL CRASH] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL CRASH] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

import { initCronJobs } from './utils/cronJobs';

// Start Server
const startServer = async () => {
  try {
    // Wait for Mongoose to connect before starting the server so db.collection is ready
    await mongoose.connect(effectiveDbUrl);
    console.log('MongoDB (Mongoose) connected successfully');
  } catch (err: any) {
    console.error('MongoDB connection error during startup:', err.message);
  }

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    initCronJobs();
    console.log('Cron jobs initialized');
  });
};

startServer();
