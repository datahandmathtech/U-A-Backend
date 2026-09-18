import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

const router = Router();

router.get('/ping', (req, res) => res.json({ status: 'pong', message: 'Backend is alive and responding instantly.' }));

router.get('/diagnostics', async (req, res) => {
  let outboundIp = 'unknown';
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json');
    const ipData: any = await ipRes.json();
    outboundIp = ipData.ip;
  } catch (e: any) {
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
    const user = await prisma.user.findFirst({ select: { id: true, email: true } });
    elapsed = Date.now() - start;
    dbStatus = 'CONNECTED_OK';
    dbError = user ? `Found user: ${user.email}` : 'No users found';
  } catch (err: any) {
    dbStatus = 'FAILED';
    dbError = (err?.name || 'Error') + ': ' + (err?.message || String(err));
  }

  const net = await import('net');
  let tcpStatus = 'unknown';
  try {
    await new Promise((resolve, reject) => {
      const s = net.createConnection(27017, 'ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net', () => {
        s.end();
        resolve('OPEN');
      });
      s.on('error', (e) => reject(e));
      s.setTimeout(3000, () => {
        s.destroy();
        reject(new Error('TCP_TIMEOUT'));
      });
    });
    tcpStatus = 'PORT_27017_REACHABLE';
  } catch (e: any) {
    tcpStatus = 'PORT_27017_BLOCKED_OR_TIMEOUT: ' + e.message;
  }

  res.json({
    serverOutboundIp: outboundIp,
    dbConfigured,
    dbType,
    dbHost: dbUrl ? dbUrl.replace(/\/\/.*?:.*?@/, '//***:***@') : null,
    tcpStatus,
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
    
    const finalEmail = email || (staffId ? `${staffId}@unnati.com` : `${name.replace(/\s+/g, '').toLowerCase()}${Math.floor(Math.random()*1000)}@unnati.com`);

    // Check if user exists by email or staffId
    const existingUser = await prisma.user.findFirst({
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

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
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
  } catch (error: any) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post(['/login', '/signin', '/user-login', '/auth-token'], async (req, res) => {
  try {
    const { email: emailOrStaffId, password } = req.body;
    
    if (!emailOrStaffId || !password) {
      return res.status(400).json({ message: 'Email/Staff ID and password are required' });
    }

    console.log('Login attempt for:', emailOrStaffId);

    const cleanInput = (emailOrStaffId || '').trim();
    const lowerInput = cleanInput.toLowerCase();
    
    let user: any = null;

    try {
      // Fast lookup with 2.5s timeout on Prisma
      user = await Promise.race([
        prisma.user.findFirst({
          where: {
            OR: [
              { email: cleanInput },
              { email: lowerInput },
              { staffId: cleanInput },
              { staffId: lowerInput },
              { name: cleanInput }
            ]
          }
        }),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Prisma query timeout')), 2500))
      ]);
    } catch (pErr) {
      console.warn('Prisma login lookup timed out or failed, using native MongoDB fallback:', pErr);
    }

    // Direct MongoDB fallback if Prisma did not return user
    if (!user) {
      try {
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (!db || mongoose.connection.readyState !== 1) {
          const directUri = process.env.DATABASE_URL || 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?ssl=true&replicaSet=atlas-icn4hi-shard-0&authSource=admin&retryWrites=true&w=majority&readPreference=primaryPreferred';
          const conn = await mongoose.createConnection(directUri, { serverSelectionTimeoutMS: 3000 }).asPromise();
          db = conn.db;
        }
        if (db) {
          const rawUser = await db.collection('User').findOne({
            $or: [
              { email: cleanInput },
              { email: lowerInput },
              { staffId: cleanInput },
              { staffId: lowerInput },
              { name: cleanInput }
            ]
          });
          if (rawUser) {
            user = {
              id: rawUser._id.toString(),
              name: rawUser.name,
              email: rawUser.email,
              password: rawUser.password,
              role: rawUser.role,
              modulesAccess: rawUser.modulesAccess || []
            };
          }
        }
      } catch (mErr) {
        console.error('Mongoose fallback also failed:', mErr);
      }
    }

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials. User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials. Incorrect password.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

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
  } catch (error: any) {
    console.error('Login Error:', error);
    res.status(500).json({ message: error.message || 'Server error during login' });
  }
});

export default router;
