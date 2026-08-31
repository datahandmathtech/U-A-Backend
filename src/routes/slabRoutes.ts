import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();


// Get all distinct slab names
router.get('/all-names', authenticate, async (req, res) => {
  try {
    const slabs = await prisma.slab.findMany({
      select: { name: true },
      distinct: ['name']
    });
    res.json(slabs.map((s: any) => s.name));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching slab names', error });
  }
});

// Get all pieces across all slabs
router.get('/pieces', authenticate, async (req, res) => {
  try {
    const pieces = await prisma.piece.findMany({
      include: {
        logs: true,
        slab: {
          include: {
            project: { select: { name: true, projectId: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(pieces);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching pieces' });
  }
});

// Get slabs for a project
router.get('/project/:projectId', authenticate, async (req, res) => {
  try {
    const { projectId } = req.params;
    const slabs = await prisma.slab.findMany({
      where: { projectId: String(projectId) },
      orderBy: { createdAt: 'asc' },
      include: {
        pieces: {
          include: { logs: true },
          orderBy: { pieceNumber: 'asc' }
        },
        inventory: true
      }
    });
    res.json(slabs);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching slabs' });
  }
});

// Create a new slab
router.post('/', authenticate, async (req, res) => {
  try {
    const { projectId, inventoryId, name, size, cost } = req.body;

    // Optional: Deduct from inventory if inventoryId is provided
    if (inventoryId) {
      const inv = await prisma.inventory.findUnique({ where: { id: inventoryId } });
      if (inv) {
        await prisma.inventory.update({
          where: { id: inventoryId },
          data: { quantity: Math.max(0, inv.quantity - 1) }
        });
        await prisma.inventoryLog.create({
          data: {
            inventoryId: inventoryId,
            type: 'OUT',
            quantity: 1,
            remarks: `Slab creation: ${name}`
          }
        });
      }
    }

    const newSlab = await prisma.slab.create({
      data: {
        projectId,
        inventoryId: inventoryId || null,
        name,
        size,
        cost: Number(cost) || 0
      }
    });

    res.status(201).json(newSlab);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error creating slab' });
  }
});

// Add pieces to a slab
router.post('/:id/pieces', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { count, productName, vendorName, size, piecesArray } = req.body;
    
    const slab = await prisma.slab.findUnique({ where: { id: String(id) }, include: { pieces: true } });
    if (!slab) return res.status(404).json({ message: 'Slab not found' });
    
    let projectMaterial = null;
    let usedQuantity = 0;
    
    // Auto-match source material
    const projectMaterials = await prisma.projectMaterial.findMany({
      where: { projectId: slab.projectId, isConsumed: false },
      include: { inventory: true }
    });

    if (projectMaterials.length > 0) {
      // Try to match by name
      let matched = projectMaterials.find(pm => 
        slab.name.toLowerCase().includes(pm.inventory.itemName.toLowerCase()) || 
        pm.inventory.itemName.toLowerCase().includes(slab.name.toLowerCase())
      );
      // Fallback to first available if no name match
      if (!matched) matched = projectMaterials[0];
      projectMaterial = matched;
    }

    const currentMaxPieceNumber = (slab as any).pieces?.length > 0 
      ? Math.max(...(slab as any).pieces.map((p: any) => p.pieceNumber)) 
      : 0;
      
    const piecesData = [];
    if (piecesArray && Array.isArray(piecesArray)) {
      for (let i = 0; i < piecesArray.length; i++) {
        const l = Number(piecesArray[i].length) || 0;
        const w = Number(piecesArray[i].width) || 0;
        let pieceArea = 0;
        // Assume length/width are in inches for piece creation, so sq ft = (L * W) / 144
        // Or if they are already in sq ft, we need to know. Usually dimensions are inches.
        // Let's just calculate L * W / 144 if L and W are > 0.
        if (l > 0 && w > 0) {
          pieceArea = (l * w) / 144;
        }

        if (piecesArray[i].name?.includes('(Full Slab)')) {
           // If full slab, use the whole project material quantity
           pieceArea = projectMaterial ? projectMaterial.quantity : pieceArea;
        }
        
        usedQuantity += pieceArea;

        piecesData.push({
          slabId: String(id),
          pieceNumber: currentMaxPieceNumber + i + 1,
          productName: piecesArray[i].name || productName || slab.name,
          vendorName: vendorName || null,
          size: piecesArray[i].size || size || null,
          stage: 'Production',
          sourceMaterialId: projectMaterial ? String(projectMaterial.id) : undefined
        });
      }
    } else {
      for (let i = 1; i <= Number(count); i++) {
        piecesData.push({
          slabId: String(id),
          pieceNumber: currentMaxPieceNumber + i,
          productName: productName || slab.name,
          vendorName: vendorName || null,
          size: size || null,
          stage: 'Production',
          sourceMaterialId: projectMaterial ? String(projectMaterial.id) : undefined
        });
      }
    }
    
    await prisma.piece.createMany({ data: piecesData });
    
    if (projectMaterial) {
       const wasteQuantity = Math.max(0, projectMaterial.quantity - usedQuantity);
       await prisma.projectMaterial.update({
           where: { id: String(projectMaterial.id) },
           data: {
             isConsumed: true,
             usedQuantity: usedQuantity,
             wasteQuantity: wasteQuantity
           }
         });
    }

    const newPieces = await prisma.piece.findMany({ 
      where: { slabId: String(id), pieceNumber: { gt: currentMaxPieceNumber } } 
    });
    
    res.status(201).json(newPieces);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error adding pieces' });
  }
});

// Update a slab
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, size, cost, requiredStages, status } = req.body;
    
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (size !== undefined) updateData.size = size;
    if (cost !== undefined) updateData.cost = Number(cost) || 0;
    if (requiredStages !== undefined) updateData.requiredStages = requiredStages;
    if (status !== undefined) updateData.status = status;

    const updatedSlab = await prisma.slab.update({
      where: { id: String(id) },
      data: updateData
    });
    res.json(updatedSlab);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating slab' });
  }
});

// Delete a slab
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find all pieces
    const pieces = await prisma.piece.findMany({ where: { slabId: String(id) } });
    const pieceIds = pieces.map(p => p.id);
    
    await prisma.pieceLog.deleteMany({
      where: { pieceId: { in: pieceIds } }
    });
    
    await prisma.piece.deleteMany({
      where: { slabId: String(id) }
    });

    await prisma.slab.delete({
      where: { id: String(id) }
    });

    res.json({ message: 'Slab deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting slab' });
  }
});

// Piece Endpoints
// Update a Piece
router.put('/piece/:id', authenticate, async (req, res) => {
  try {
    const { vendorName, vendorId, size, status, productName, stage } = req.body;
    const updatedPiece = await prisma.piece.update({
      where: { id: String(req.params.id) },
      data: { vendorName, vendorId, size, status, productName, stage }
    });
    res.json(updatedPiece);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating piece' });
  }
});

// Delete a Piece
router.delete('/piece/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // First delete associated logs
    await prisma.pieceLog.deleteMany({
      where: { pieceId: String(id) }
    });
    
    // Delete piece
    await prisma.piece.delete({
      where: { id: String(id) }
    });
    
    res.json({ message: 'Piece deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error deleting piece' });
  }
});

// Add PieceLog (Punch In / Out / Photo)
router.post('/piece/:id/log', authenticate, async (req: any, res: any) => {
  try {
    const { stage, status, operatorId, machineId, startPhotoUrl, endPhotoUrl, remarks, vendorName } = req.body;
    
    if (status === 'completed' || status === 'pending_approval') {
       const activeLog = await prisma.pieceLog.findFirst({
         where: { pieceId: req.params.id, status: 'active' },
         orderBy: { createdAt: 'desc' }
       });
       
       if (activeLog) {
         const updatedLog = await prisma.pieceLog.update({
           where: { id: activeLog.id },
           data: {
             status: status === 'completed' ? 'completed' : 'approved',
             endTime: new Date(),
             endPhotoUrl,
             remarks
           }
         });
         
         await prisma.piece.update({
           where: { id: req.params.id },
           data: { status: 'completed' }
         });
         
         return res.json(updatedLog);
       }
    }
    
    const newLog = await prisma.pieceLog.create({
      data: {
        pieceId: req.params.id,
        stage,
        status: status || 'active',
        operatorId,
        machineId,
        startPhotoUrl,
        endPhotoUrl,
        remarks,
        vendorName
      }
    });
    
    await prisma.piece.update({
      where: { id: req.params.id },
      data: { stage, status: status === 'active' ? 'active' : 'pending' }
    });
    
    res.status(201).json(newLog);
  } catch (error) {
    res.status(500).json({ message: 'Server error creating piece log' });
  }
});

export default router;
