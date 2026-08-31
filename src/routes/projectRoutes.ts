import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Get all projects
router.get('/', authenticate, async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { 
        assignedTo: { select: { name: true } },
        quotations: { select: { products: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        slabs: { select: { _count: { select: { pieces: true } } } }
      }
    });

    const enrichedProjects = projects.map(p => {
      let calculatedTotalPieces = 0;
      if (p.quotations && p.quotations.length > 0) {
        const firstQuote = p.quotations[0];
        if (firstQuote && firstQuote.products) {
          const products = firstQuote.products as any[];
          if (Array.isArray(products)) {
            calculatedTotalPieces = products.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
          }
        }
      }

      // Completed Pieces = Total number of actual pieces that exist in the pipeline for this project
      let calculatedCompletedPieces = p.slabs?.reduce((sum: number, slab: any) => sum + (slab._count?.pieces || 0), 0) || 0;

      // We remove the included relations from the response to save payload size, 
      // but attach the calculated fields.
      const { quotations, slabs, ...projectData } = p;

      // Cap completed pieces to not exceed total pieces (to match item-based counting)
      if (calculatedTotalPieces > 0 && calculatedCompletedPieces > calculatedTotalPieces) {
        calculatedCompletedPieces = calculatedTotalPieces;
      }

      return {
        ...projectData,
        products: p.quotations?.[0]?.products || [],
        totalPieces: calculatedTotalPieces > 0 ? calculatedTotalPieces : projectData.totalPieces,
        completedPieces: calculatedCompletedPieces > 0 ? calculatedCompletedPieces : projectData.completedPieces,
        deliveryDate: projectData.deadline || projectData.deliveryDate,
        clientHandle: projectData.clientHandle || projectData.assignedTo?.name
      };
    });

    res.json(enrichedProjects);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching projects' });
  }
});

// Create a new project (Enquiry)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: String(id) },
      include: { 
        assignedTo: { select: { name: true } }, 
        invoices: true,
        quotations: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching project' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description, status, startDate, deadline, assignedToId, clientName, clientContact, clientEmail, enquirySource, location, requirements, createdAt, customerPhoto, totalPieces, completedPieces, deliveryDate, clientHandle } = req.body;
    
    // Auto-generate project ID (e.g. U-A-01) resetting per Financial Year
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed (April is 3)
    const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;
    const fyStartDate = new Date(fyStartYear, 3, 1); // April 1st

    const latestProject = await prisma.project.findFirst({
      where: {
        createdAt: {
          gte: fyStartDate
        },
        projectId: { startsWith: 'U-A-' }
      },
      orderBy: { createdAt: 'desc' }
    });

    let nextNum = 1;
    if (latestProject && latestProject.projectId) {
      const match = latestProject.projectId.match(/U-A-(\d+)/);
      if (match && match[1]) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    
    // To be absolutely safe against collisions from manual edits or deletions not caught by latestProject
    // We will query if this exact ID exists. If it does, we increment.
    let projectId = `U-A-${String(nextNum).padStart(2, '0')}`;
    let exists = await prisma.project.findUnique({ where: { projectId } });
    while (exists) {
      nextNum++;
      projectId = `U-A-${String(nextNum).padStart(2, '0')}`;
      exists = await prisma.project.findUnique({ where: { projectId } });
    }

    const newProject = await prisma.project.create({
      data: {
        projectId,
        name,
        description,
        clientName,
        clientContact,
        clientEmail,
        enquirySource,
        location,
        requirements,
        createdAt: createdAt ? new Date(createdAt) : undefined,
        status: status || 'enquiry',
        startDate: startDate ? new Date(startDate) : new Date(),
        deadline: deadline ? new Date(deadline) : null,
        assignedToId: assignedToId || undefined,
        customerPhoto,
        totalPieces: totalPieces ? parseInt(totalPieces) : 0,
        completedPieces: completedPieces ? parseInt(completedPieces) : 0,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        clientHandle
      }
    });
    
    res.status(201).json(newProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'Server error creating project' });
  }
});

// Sync slabs from quotation (for backward compatibility / stuck projects)
router.post('/:id/sync-slabs', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: String(id) },
      include: { slabs: true, quotations: { orderBy: { createdAt: 'desc' } } }
    });

    if (!project) return res.status(404).json({ message: 'Project not found' });

    const existingSlabs = await prisma.slab.findMany({ where: { projectId: String(id) }, select: { name: true } });
    const existingNames = new Set(existingSlabs.map(s => s.name));
    
    const desiredSlabs = [];

    if (project.quotations.length > 0) {
      const firstQuote = project.quotations[0];
      if (firstQuote && firstQuote.products) {
        const products = firstQuote.products as any[];
        for (const prod of products) {
          const qty = Number(prod.qty) || 1;
          for (let i = 1; i <= qty; i++) {
            const pieceName = qty > 1 ? String(prod.category || 'Product') + ' ' + i : String(prod.category || 'Product');
            const sizeStr = String(prod.length || 0) + 'L x ' + String(prod.width || 0) + 'W' + (prod.breadth ? ' | ' + prod.breadth + 'MM' : '');
            desiredSlabs.push({ name: pieceName, size: sizeStr });
          }
        }
      }
    }

    const materials = await prisma.projectMaterial.findMany({
      where: { projectId: String(id) },
      include: { inventory: true }
    });
    
    for (const pm of materials) {
      if (pm.inventory.type === 'slab' || pm.inventory.type === 'block') {
         const typeName = pm.inventory.jobWorkType === 'client' ? 'Client' : 'Unnati';
         const blockName = pm.inventory.type === 'block' ? 'Block' : 'Slab';
         const idPart = pm.inventory.blockNumber || pm.id.substring(pm.id.length-4);
         const pieceName = typeName + ' ' + blockName + ': ' + pm.inventory.itemName + ' (ID: ' + idPart + ')';
         const sizeStr = String(pm.inventory.length || 0) + 'L x ' + String(pm.inventory.width || 0) + 'W | ' + String(pm.inventory.thickness || 0) + 'MM';
         desiredSlabs.push({ name: pieceName, size: sizeStr });
      }
    }

    let addedCount = 0;
    for (const desired of desiredSlabs) {
      if (!existingNames.has(desired.name)) {
        await prisma.slab.create({
          data: {
            projectId: project.id,
            name: desired.name,
            size: desired.size,
            status: 'pending'
          }
        });
        existingNames.add(desired.name);
        addedCount++;
      }
    }

    res.json({ message: 'Synced new slabs.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error syncing slabs' });
  }
});

// Update project (Status, workflow progression)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.deadline) updateData.deadline = new Date(updateData.deadline);

    const updated = await prisma.project.update({
      where: { id: String(id) },
      data: updateData,
      include: { slabs: true, quotations: { orderBy: { createdAt: 'desc' } } }
    });
    
    // Auto-generate Slabs and Pieces if transitioning to an active work order stage from quotation
    const activeStatuses = ['shop_drawing', 'material_planning', 'production', 'work_order', 'completed'];
    if (updateData.status && activeStatuses.includes(updateData.status) && updated.slabs.length === 0 && updated.quotations.length > 0) {
      const firstQuote = updated.quotations[0];
      if (firstQuote && firstQuote.products) {
        const products = firstQuote.products as any[];
        for (const prod of products) {
          const qty = Number(prod.qty) || 1;
          for (let i = 1; i <= qty; i++) {
            const pieceName = qty > 1 ? `${prod.category || 'Product'} ${i}` : (prod.category || 'Product');
            const sizeStr = `${prod.length || 0}L x ${prod.width || 0}W ${prod.breadth ? `| ${prod.breadth}MM` : ''}`;
            await prisma.slab.create({
              data: {
                projectId: updated.id,
                name: pieceName,
                size: sizeStr,
                status: 'pending'
              }
            });
          }
        }
      }
    }
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error updating project' });
  }
});

// Delete project
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find all slabs for this project to delete their pieces and pieceLogs
    const slabs = await prisma.slab.findMany({ where: { projectId: String(id) }, select: { id: true } });
    const slabIds = slabs.map(s => s.id);
    
    const pieces = await prisma.piece.findMany({ where: { slabId: { in: slabIds } }, select: { id: true } });
    const pieceIds = pieces.map(p => p.id);

    // Run deletions in a transaction to ensure everything is deleted or nothing is
    await prisma.$transaction([
      prisma.pieceLog.deleteMany({ where: { pieceId: { in: pieceIds } } }),
      prisma.piece.deleteMany({ where: { slabId: { in: slabIds } } }),
      prisma.approvalRecord.deleteMany({ where: { projectId: String(id) } }),
      prisma.shopDrawing.deleteMany({ where: { projectId: String(id) } }),
      prisma.design.deleteMany({ where: { projectId: String(id) } }),
      prisma.quotation.deleteMany({ where: { projectId: String(id) } }),
      prisma.invoice.deleteMany({ where: { projectId: String(id) } }),
      prisma.productionLog.deleteMany({ where: { projectId: String(id) } }),
      prisma.projectMaterial.deleteMany({ where: { projectId: String(id) } }),
      prisma.machineLog.deleteMany({ where: { projectId: String(id) } }),
      prisma.laborContract.deleteMany({ where: { projectId: String(id) } }),
      prisma.projectClosure.deleteMany({ where: { projectId: String(id) } }),
      prisma.dispatch.deleteMany({ where: { projectId: String(id) } }),
      prisma.qA_QC.deleteMany({ where: { projectId: String(id) } }),
      prisma.crate.deleteMany({ where: { projectId: String(id) } }),
      prisma.slab.deleteMany({ where: { projectId: String(id) } }),
      prisma.project.delete({ where: { id: String(id) } })
    ]);
    
    res.json({ message: 'Project and all related entries deleted successfully' });
  } catch (error: any) {
    console.error("Delete Project Error:", error);
    res.status(500).json({ message: error.message || 'Server error deleting project' });
  }
});

// Get materials reserved for project
router.get('/:id/materials', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const materials = await prisma.projectMaterial.findMany({
      where: { projectId: String(id) },
      include: { inventory: true },
      orderBy: { addedAt: 'desc' }
    });
    res.json(materials);
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching project materials' });
  }
});

// Reserve material for project
router.post('/:id/materials', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { inventoryId, quantity, cost } = req.body;
    
    // Check inventory stock
    const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } });
    if (!inventory) {
      return res.status(400).json({ message: 'Inventory item not found' });
    }

    // Do not deduct stock from global inventory here. It gets deducted when the piece is Approved in production.
    const projectMaterial = await prisma.projectMaterial.create({
      data: {
        projectId: String(id),
        inventoryId,
        quantity: Number(quantity),
        cost: Number(cost)
      }
    });
    
    res.status(201).json(projectMaterial);
  } catch (error) {
    res.status(500).json({ message: 'Server error reserving material' });
  }
});

// Delete reserved material from project
router.delete('/:id/materials/:materialId', authenticate, async (req, res) => {
  try {
    const { materialId } = req.params;
    
    const pm = await prisma.projectMaterial.findUnique({ where: { id: String(materialId) } });
    if (!pm) return res.status(404).json({ message: 'Material reservation not found' });
    
    const invId = pm.inventoryId;

    await prisma.$transaction([
      prisma.projectMaterial.delete({ where: { id: String(materialId) } }),
      prisma.inventoryLog.deleteMany({ where: { inventoryId: invId } }),
      prisma.inventory.delete({ where: { id: invId } })
    ]);
    
    res.json({ message: 'Material reservation and associated inventory deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error deleting material reservation' });
  }
});

export default router;
