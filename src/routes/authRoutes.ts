import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';

const router = Router();

router.get('/ping', (req, res) => res.json({ status: 'pong', message: 'Backend is alive and responding instantly.' }));

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
router.post('/login', async (req, res) => {
  try {
    const { email: emailOrStaffId, password } = req.body;
    
    console.log('Login attempt for:', emailOrStaffId);

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: emailOrStaffId, mode: 'insensitive' } },
          { staffId: { equals: emailOrStaffId, mode: 'insensitive' } },
          { name: { equals: emailOrStaffId, mode: 'insensitive' } }
        ]
      }
    });
    
    console.log('User found:', user ? user.email : 'None');

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
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
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
});

export default router;
