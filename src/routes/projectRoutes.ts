import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';

const router = Router();

// Get all projects
router.get('/', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('all_projects');
    if (cached) return res.json(cached);

    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { 
        assignedTo: { select: { name: true } },
        quotations: { select: { products: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        slabs: {
          include: {
            pieces: {
              include: {
                logs: true
              }
            }
          }
        }
      }
    });

    const enrichedProjects = projects.map(p => {
      let calculatedTotalPieces = p.totalPieces || 0;
      if (p.quotations && p.quotations.length > 0) {
        const firstQuote = p.quotations[0];
        if (firstQuote && firstQuote.products) {
          const products = firstQuote.products as any[];
          if (Array.isArray(products) && products.length > 0) {
            const sum = products.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
            if (sum > 0) calculatedTotalPieces = sum;
          }
        }
      }

      const { quotations, ...projectData } = p;

      return {
        ...projectData,
        products: p.quotations?.[0]?.products || [],
        totalPieces: calculatedTotalPieces,
        completedPieces: projectData.completedPieces || 0,
        deliveryDate: projectData.deadline || projectData.deliveryDate,
        clientHandle: projectData.clientHandle || projectData.assignedTo?.name
      };
    });

    fastCache.set('all_projects', enrichedProjects, 120);
    res.json(enrichedProjects);
  } catch (error) {
    console.error('Projects fetch error:', error);
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
    const { name, description, status, startDate, deadline, assignedToId, clientName, clientContact, clientEmail, enquirySource, location, requirements, createdAt, customerPhoto, totalPieces, completedPieces, deliveryDate, clientHandle, isDirectWorkOrder } = req.body;
    
    // Auto-generate project ID (e.g. U-A-01, U-A-13) safely in a single scan
    const allProjects = await prisma.project.findMany({
      select: { projectId: true }
    });

    let maxNum = 0;
    allProjects.forEach(p => {
      const match = p.projectId ? p.projectId.match(/U-A-(\d+)/) : null;
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });

    const nextNum = maxNum + 1;
    const projectId = `U-A-${String(nextNum).padStart(2, '0')}`;
    const finalName = (name && name.trim()) ? name.trim() : `${(clientName || 'New Client').trim()} - Enquiry`;

    const newProject = await prisma.project.create({
      data: {
        projectId,
        name: finalName,
        description: description || requirements || '',
        clientName: clientName || 'Unnamed Client',
        clientContact: clientContact || '',
        clientEmail: clientEmail || '',
        enquirySource: enquirySource || 'WhatsApp',
        location: location || '',
        requirements: requirements || description || '',
        createdAt: createdAt ? new Date(createdAt) : new Date(),
        status: status || 'enquiry',
        isDirectWorkOrder: isDirectWorkOrder || false,
        startDate: startDate ? new Date(startDate) : new Date(),
        deadline: deadline ? new Date(deadline) : null,
        assignedToId: (assignedToId && typeof assignedToId === 'string' && assignedToId.length === 24) ? assignedToId : undefined,
        customerPhoto: customerPhoto || null,
        totalPieces: totalPieces ? parseInt(totalPieces, 10) : 0,
        completedPieces: completedPieces ? parseInt(completedPieces, 10) : 0,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        clientHandle: clientHandle || null
      }
    });
    
    fastCache.invalidate('all_projects');
    fastCache.invalidate('dashboard_summary');
    res.status(201).json(newProject);
  } catch (error: any) {
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'Server error creating project', error: error?.message || error });
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



    let addedCount = 0;
    let updatedCount = 0;
    
    // Fetch full existing slabs for comparison
    const fullExistingSlabs = await prisma.slab.findMany({ where: { projectId: String(id) } });
    const slabMap = new Map(fullExistingSlabs.map(s => [s.name, s]));

    for (const desired of desiredSlabs) {
      if (!slabMap.has(desired.name)) {
        await prisma.slab.create({
          data: {
            projectId: project.id,
            name: desired.name,
            size: desired.size,
            status: 'pending'
          }
        });
        slabMap.set(desired.name, { name: desired.name } as any);
        addedCount++;
      } else {
        // Update size if it has changed
        const existing = slabMap.get(desired.name);
        if (existing && existing.size !== desired.size) {
          await prisma.slab.update({
            where: { id: existing.id },
            data: { size: desired.size }
          });
          updatedCount++;
        }
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
    const rawData = { ...req.body };
    
    // Remove relation / virtual fields that do not exist on the Prisma Project model
    delete rawData.id;
    delete rawData._id;
    delete rawData.products;
    delete rawData.slabs;
    delete rawData.quotations;
    delete rawData.invoices;
    delete rawData.assignedTo;
    delete rawData.createdAt;
    delete rawData.updatedAt;

    const updateData: any = {};
    const allowedKeys = [
      'name', 'description', 'status', 'isDirectWorkOrder', 'startDate', 'deadline',
      'progressPercentage', 'assignedToId', 'totalPieces', 'completedPieces',
      'deliveryDate', 'clientHandle', 'clientName', 'clientContact', 'clientEmail',
      'customerPhoto', 'enquirySource', 'location', 'requirements', 'designFiles',
      'receiptUrl', 'workOrderUrl'
    ];

    for (const key of allowedKeys) {
      if (rawData[key] !== undefined) {
        updateData[key] = rawData[key];
      }
    }

    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.deadline) updateData.deadline = new Date(updateData.deadline);
    if (updateData.deliveryDate) updateData.deliveryDate = new Date(updateData.deliveryDate);
    if (updateData.totalPieces !== undefined) updateData.totalPieces = parseInt(updateData.totalPieces) || 0;
    if (updateData.completedPieces !== undefined) updateData.completedPieces = parseInt(updateData.completedPieces) || 0;

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
    
    fastCache.invalidate('all_projects');
    fastCache.invalidate('dashboard_summary');
    res.json(updated);
  } catch (error: any) {
    console.error("Error updating project:", error);
    res.status(500).json({ message: error.message || 'Server error updating project' });
  }
});

// Delete project
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find project by id (ObjectId) or projectId (string identifier)
    const existingProject = await prisma.project.findFirst({
      where: {
        OR: [
          { id: String(id) },
          { projectId: String(id) }
        ]
      }
    });

    if (!existingProject) {
      fastCache.invalidate('all_projects');
      fastCache.invalidate('dashboard_summary');
      fastCache.invalidate('project_hierarchy_v2');
      fastCache.invalidate('project_hierarchy_v3');
      fastCache.invalidate('all_names_v2');
      return res.json({ message: 'Project deleted or does not exist' });
    }

    const realId = existingProject.id;

    // Find all slabs for this project to delete their pieces and pieceLogs
    const slabs = await prisma.slab.findMany({ where: { projectId: realId }, select: { id: true } });
    const slabIds = slabs.map(s => s.id);
    
    const pieces = await prisma.piece.findMany({ where: { slabId: { in: slabIds } }, select: { id: true } });
    const pieceIds = pieces.map(p => p.id);

    // Delete child dependencies safely
    if (pieceIds.length > 0) {
      await prisma.pieceLog.deleteMany({ where: { pieceId: { in: pieceIds } } }).catch(e => console.error("pieceLog del error:", e));
    }
    if (slabIds.length > 0) {
      await prisma.piece.deleteMany({ where: { slabId: { in: slabIds } } }).catch(e => console.error("piece del error:", e));
      await prisma.slab.deleteMany({ where: { id: { in: slabIds } } }).catch(e => console.error("slab del error:", e));
    }
    
    await prisma.approvalRecord.deleteMany({ where: { projectId: realId } }).catch(e => console.error("approvalRecord del error:", e));
    await prisma.shopDrawing.deleteMany({ where: { projectId: realId } }).catch(e => console.error("shopDrawing del error:", e));
    await prisma.design.deleteMany({ where: { projectId: realId } }).catch(e => console.error("design del error:", e));
    await prisma.quotation.deleteMany({ where: { projectId: realId } }).catch(e => console.error("quotation del error:", e));
    await prisma.invoice.deleteMany({ where: { projectId: realId } }).catch(e => console.error("invoice del error:", e));
    await prisma.productionLog.deleteMany({ where: { projectId: realId } }).catch(e => console.error("productionLog del error:", e));
    await prisma.projectMaterial.deleteMany({ where: { projectId: realId } }).catch(e => console.error("projectMaterial del error:", e));
    await prisma.machineLog.deleteMany({ where: { projectId: realId } }).catch(e => console.error("machineLog del error:", e));
    await prisma.laborContract.deleteMany({ where: { projectId: realId } }).catch(e => console.error("laborContract del error:", e));
    await prisma.projectClosure.deleteMany({ where: { projectId: realId } }).catch(e => console.error("projectClosure del error:", e));
    await prisma.crate.deleteMany({ where: { projectId: realId } }).catch(e => console.error("crate del error:", e));
    await prisma.dispatch.deleteMany({ where: { projectId: realId } }).catch(e => console.error("dispatch del error:", e));
    await prisma.qA_QC.deleteMany({ where: { projectId: realId } }).catch(e => console.error("qA_QC del error:", e));

    await prisma.project.deleteMany({
      where: {
        OR: [
          { id: realId },
          { projectId: String(id) }
        ]
      }
    });
    
    fastCache.invalidate('all_projects');
    fastCache.invalidate('dashboard_summary');
    fastCache.invalidate('project_hierarchy_v2');
    fastCache.invalidate('project_hierarchy_v3');
    fastCache.invalidate('all_names_v2');

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
