import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middlewares/authMiddleware';
import { fastCache } from '../utils/fastCache';
import {
  syncSlabsAndQuotationFromProducts,
  syncQuotationFromSlabs,
  ensureMergedProductsForProject,
  invalidateProjectCaches
} from '../utils/projectSync';

const router = Router();

// Get all projects
router.get('/', authenticate, async (req, res) => {
  try {
    const cached = fastCache.get('all_projects');
    if (cached) return res.json(cached);

    let enrichedProjects: any[] = [];
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    

    if (db) {
      try {
        const rawProjects = await db.collection('Project').find({}).sort({ createdAt: -1 }).toArray();
        const projectIds = rawProjects.map((p: any) => p._id.toString());
        const projectObjIds = projectIds.map((id: string) => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
        
        const [rawSlabs, rawQuotes, rawUsers] = await Promise.all([
          db.collection('Slab').find({ $or: [{ projectId: { $in: projectIds } }, { projectId: { $in: projectObjIds } }] }).toArray(),
          db.collection('Quotation').find({ $or: [{ projectId: { $in: projectIds } }, { projectId: { $in: projectObjIds } }] }).sort({ createdAt: -1 }).toArray(),
          db.collection('User').find({}, { projection: { name: 1 } }).toArray()
        ]);

        const slabIds = rawSlabs.map((s: any) => s._id.toString());
        const slabObjIds = slabIds.map((id: string) => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
        
        const rawPieces = await db.collection('Piece').find({ $or: [{ slabId: { $in: slabIds } }, { slabId: { $in: slabObjIds } }] }).toArray();

        const userMap = new Map();
        rawUsers.forEach((u: any) => userMap.set(u._id.toString(), u.name));

        const quoteMap = new Map();
        rawQuotes.forEach((q: any) => {
          const pId = q.projectId?.toString();
          if (!quoteMap.has(pId)) quoteMap.set(pId, q);
        });

        const pieceMap = new Map();
        rawPieces.forEach((p: any) => {
          const sId = p.slabId?.toString();
          if (!pieceMap.has(sId)) pieceMap.set(sId, []);
          pieceMap.get(sId).push(p);
        });

        const slabMap = new Map();
        rawSlabs.forEach((s: any) => {
          const sIdStr = s._id.toString();
          const sObj = {
            id: sIdStr,
            name: s.name,
            size: s.size,
            status: s.status,
            requiredStages: s.requiredStages,
            pieces: pieceMap.get(sIdStr) || []
          };
          const pIdStr = s.projectId?.toString();
          if (!slabMap.has(pIdStr)) slabMap.set(pIdStr, []);
          slabMap.get(pIdStr).push(sObj);
        });

        enrichedProjects = rawProjects.map((p: any) => {
          const pId = p._id.toString();
          const assignedName = p.assignedToId ? userMap.get(p.assignedToId) : null;
          const firstQuote = quoteMap.get(pId);
          const projSlabs = slabMap.get(pId) || [];
          const { products: mergedProducts } = ensureMergedProductsForProject(
            pId,
            projSlabs,
            firstQuote ? [{ ...firstQuote, id: firstQuote._id.toString() }] : []
          );
          let calculatedTotalPieces = Number(p.totalPieces) || 0;
          if (projSlabs.length > 0) {
            calculatedTotalPieces = projSlabs.length;
          } else if (calculatedTotalPieces <= 0 && Array.isArray(mergedProducts) && mergedProducts.length > 0) {
            const sum = mergedProducts.reduce((acc: number, curr: any) => acc + (Number(curr.qty) || 0), 0);
            if (sum > 0) calculatedTotalPieces = sum;
          }

          return {
            id: pId,
            projectId: p.projectId,
            name: p.name,
            description: p.description,
            status: p.status,
            clientName: p.clientName,
            clientContact: p.clientContact,
            clientEmail: p.clientEmail,
            customerPhoto: p.customerPhoto,
            enquirySource: p.enquirySource,
            location: p.location,
            requirements: p.requirements,
            startDate: p.startDate,
            deadline: p.deadline,
            deliveryDate: p.deadline || p.deliveryDate,
            totalPieces: calculatedTotalPieces,
            completedPieces: p.completedPieces || 0,
            progressPercentage: p.progressPercentage || 0,
            assignedToId: p.assignedToId,
            assignedTo: assignedName ? { name: assignedName } : null,
            clientHandle: p.clientHandle || assignedName,
            isDirectWorkOrder: p.isDirectWorkOrder || false,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            products: mergedProducts,
            slabs: projSlabs
          };
        });

        fastCache.set('all_projects', enrichedProjects, 60);
        return res.json(enrichedProjects);
      } catch (mErr) {
        console.warn('Mongoose project fetch failed, falling back to Prisma:', mErr);
      }
    }

    const projects = await prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        include: { 
          assignedTo: { select: { name: true } },
          quotations: { select: { id: true, products: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          slabs: {
            select: {
              id: true,
              name: true,
              size: true,
              status: true,
              requiredStages: true,
              pieces: {
                select: {
                  id: true,
                  pieceNumber: true,
                  productName: true,
                  size: true,
                  stage: true,
                  status: true
                }
              }
            }
          }
        }
      });

      enrichedProjects = projects.map(p => {
        const projSlabs = p.slabs || [];
        const { products: mergedProducts } = ensureMergedProductsForProject(p.id, projSlabs, p.quotations || []);
        let calculatedTotalPieces = Number(p.totalPieces) || 0;
        if (projSlabs.length > 0) {
          calculatedTotalPieces = projSlabs.length;
        } else if (calculatedTotalPieces <= 0 && Array.isArray(mergedProducts) && mergedProducts.length > 0) {
          const sum = mergedProducts.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
          if (sum > 0) calculatedTotalPieces = sum;
        }

        const { quotations, ...projectData } = p;

        return {
          ...projectData,
          products: mergedProducts,
          slabs: projSlabs,
          totalPieces: calculatedTotalPieces,
          completedPieces: projectData.completedPieces || 0,
          deliveryDate: projectData.deadline || projectData.deliveryDate,
          clientHandle: projectData.clientHandle || projectData.assignedTo?.name
        };
      });

    fastCache.set('all_projects', enrichedProjects, 60);
    res.json(enrichedProjects);
  } catch (error) {
    console.error('Projects fetch error:', error);
    res.status(500).json({ message: 'Server error fetching projects' });
  }
});

// Get single project
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        let pQuery: any = { id: String(id) };
        if (mongoose.Types.ObjectId.isValid(id)) {
          pQuery = { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { id: String(id) }, { projectId: String(id) }] };
        } else {
          pQuery = { $or: [{ id: String(id) }, { projectId: String(id) }] };
        }
        const rawProj = await db.collection('Project').findOne(pQuery);
        if (rawProj) {
          const pId = rawProj._id.toString();
          const pObjId = rawProj._id;
          const pCustomId = rawProj.id || pId;
          const projRefQuery = { $or: [{ projectId: pId }, { projectId: pObjId }, { projectId: pCustomId }] };

          const [invoices, quotations, rawSlabs, user] = await Promise.all([
            db.collection('Invoice').find(projRefQuery).toArray(),
            db.collection('Quotation').find(projRefQuery).sort({ createdAt: -1 }).toArray(),
            db.collection('Slab').find(projRefQuery).sort({ createdAt: 1 }).toArray(),
            rawProj.assignedToId ? db.collection('User').findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(rawProj.assignedToId) ? new mongoose.Types.ObjectId(rawProj.assignedToId) : null }, { id: rawProj.assignedToId }] }, { projection: { name: 1 } }) : null
          ]);

          const formattedSlabs = rawSlabs.map((s: any) => ({ ...s, id: s._id.toString() }));
          const formattedQuotes = quotations.map((q: any) => ({ ...q, id: q._id.toString() }));
          const { products: mergedProducts, quotations: mergedQuotes, needsDbSync } = ensureMergedProductsForProject(
            pId,
            formattedSlabs,
            formattedQuotes
          );

          if (needsDbSync) {
            syncQuotationFromSlabs(pId).catch(() => {});
          }

          return res.json({
            id: pId,
            projectId: rawProj.projectId,
            name: rawProj.name,
            description: rawProj.description,
            status: rawProj.status,
            clientName: rawProj.clientName,
            clientContact: rawProj.clientContact,
            clientEmail: rawProj.clientEmail,
            customerPhoto: rawProj.customerPhoto,
            enquirySource: rawProj.enquirySource,
            location: rawProj.location,
            requirements: rawProj.requirements,
            startDate: rawProj.startDate,
            deadline: rawProj.deadline,
            deliveryDate: rawProj.deadline || rawProj.deliveryDate,
            totalPieces: formattedSlabs.length || rawProj.totalPieces || 0,
            completedPieces: rawProj.completedPieces || 0,
            progressPercentage: rawProj.progressPercentage || 0,
            assignedToId: rawProj.assignedToId,
            assignedTo: user ? { name: user.name } : null,
            clientHandle: rawProj.clientHandle || user?.name,
            isDirectWorkOrder: rawProj.isDirectWorkOrder || false,
            createdAt: rawProj.createdAt,
            updatedAt: rawProj.updatedAt,
            products: mergedProducts,
            slabs: formattedSlabs,
            invoices: invoices.map((inv: any) => ({ ...inv, id: inv._id.toString() })),
            quotations: mergedQuotes
          });
        }
      } catch (mErr) {
        console.warn('Mongoose single project fetch failed, falling back to Prisma:', mErr);
      }
    }

    const project = await prisma.project.findFirst({
      where: {
        OR: [
          { id: String(id) },
          { projectId: String(id) }
        ]
      },
      include: { 
        assignedTo: { select: { name: true } }, 
        invoices: true,
        slabs: { orderBy: { createdAt: 'asc' } },
        quotations: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    const { products: mergedProducts, quotations: mergedQuotes, needsDbSync } = ensureMergedProductsForProject(
      project.id,
      project.slabs || [],
      project.quotations || []
    );
    if (needsDbSync) {
      syncQuotationFromSlabs(project.id).catch(() => {});
    }
    res.json({
      ...project,
      products: mergedProducts,
      quotations: mergedQuotes
    });
  } catch (error) {
    console.error('Error fetching project by id:', error);
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

    const firstQuote = project.quotations[0];
    const quoteProducts = Array.isArray(firstQuote?.products) ? (firstQuote.products as any[]) : [];

    if (quoteProducts.length > 0) {
      await syncSlabsAndQuotationFromProducts(project.id, quoteProducts, {
        removeUnmatchedSlabs: true,
        updateQuotationRecord: true
      });
    } else if (project.slabs.length > 0) {
      await syncQuotationFromSlabs(project.id);
    }

    invalidateProjectCaches(project.id);
    res.json({ message: 'Synced slabs and quotation products.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error syncing slabs' });
  }
});

// Update project (Status, workflow progression)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const incomingProducts = Array.isArray(req.body.products) ? req.body.products : null;
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

    if (updateData.startDate !== undefined) {
      if (!updateData.startDate) {
        updateData.startDate = null;
      } else {
        const d = new Date(updateData.startDate);
        updateData.startDate = isNaN(d.getTime()) ? null : d;
      }
    }
    if (updateData.deadline !== undefined) {
      if (!updateData.deadline) {
        updateData.deadline = null;
      } else {
        const d = new Date(updateData.deadline);
        updateData.deadline = isNaN(d.getTime()) ? null : d;
      }
    }
    if (updateData.deliveryDate !== undefined) {
      if (!updateData.deliveryDate) {
        updateData.deliveryDate = null;
      } else {
        const d = new Date(updateData.deliveryDate);
        updateData.deliveryDate = isNaN(d.getTime()) ? null : d;
      }
    }
    if (updateData.totalPieces !== undefined) updateData.totalPieces = parseInt(updateData.totalPieces) || 0;
    if (updateData.completedPieces !== undefined) updateData.completedPieces = parseInt(updateData.completedPieces) || 0;

    const updated = await prisma.project.update({
      where: { id: String(id) },
      data: updateData,
      include: { slabs: true, quotations: { orderBy: { createdAt: 'desc' } } }
    });

    // Sync incoming products & slabs if provided during edit
    if (incomingProducts) {
      await syncSlabsAndQuotationFromProducts(String(id), incomingProducts, {
        removeUnmatchedSlabs: true,
        updateQuotationRecord: true
      });
    } else {
      // Auto-generate Slabs if transitioning to an active work order stage from quotation
      const activeStatuses = ['shop_drawing', 'material_planning', 'production', 'work_order', 'completed'];
      if (updateData.status && activeStatuses.includes(updateData.status) && updated.slabs.length === 0 && updated.quotations.length > 0) {
        const firstQuote = updated.quotations[0];
        if (firstQuote && Array.isArray(firstQuote.products) && firstQuote.products.length > 0) {
          await syncSlabsAndQuotationFromProducts(updated.id, firstQuote.products as any[], {
            removeUnmatchedSlabs: false,
            updateQuotationRecord: true
          });
        }
      }
    }
    
    invalidateProjectCaches(String(id));
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

// Get materials reserved for project (including Inventory items linked via Slabs, Client/Supplier name, or InventoryLog deductions)
router.get('/:id/materials', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    let db = mongoose.connection?.db;

    if (db) {
      try {
        const pObjId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
        const projectDoc = await db.collection('Project').findOne({
          $or: [
            ...(pObjId ? [{ _id: pObjId }] : []),
            { _id: String(id) },
            { id: String(id) }
          ]
        });

        const rawMaterials = await db.collection('ProjectMaterial').find({
          $or: [
            { projectId: String(id) },
            ...(pObjId ? [{ projectId: pObjId }] : [])
          ]
        }).sort({ addedAt: -1 }).toArray();

        const projectSlabs = await db.collection('Slab').find({
          $or: [
            { projectId: String(id) },
            ...(pObjId ? [{ projectId: pObjId }] : [])
          ]
        }).toArray();

        const slabInvIds = projectSlabs.map((s: any) => s.inventoryId?.toString()).filter(Boolean);
        const slabIds = projectSlabs.map((s: any) => s._id.toString());
        const projectPieces = slabIds.length > 0
          ? await db.collection('Piece').find({
              $or: [
                { slabId: { $in: slabIds } },
                { slabId: { $in: slabIds.filter((sId: string) => mongoose.Types.ObjectId.isValid(sId)).map((sId: string) => new mongoose.Types.ObjectId(sId)) } }
              ]
            }).toArray()
          : [];
        const pieceIds = projectPieces.map((p: any) => p._id.toString());

        // Also find any InventoryLog entries referencing this project or its pieces
        const logOrConditions: any[] = [
          { remarks: { $regex: `\\[Project:${String(id)}\\]`, $options: 'i' } }
        ];
        if (pieceIds.length > 0) {
          logOrConditions.push({ remarks: { $regex: `\\[Piece:(${pieceIds.join('|')})\\]`, $options: 'i' } });
        }
        const matchedLogsForProj = await db.collection('InventoryLog').find({ $or: logOrConditions }).toArray();
        const logInvIds = matchedLogsForProj.map((l: any) => l.inventoryId?.toString()).filter(Boolean);

        // Also find any Inventory items whose supplier strictly matches the project's clientName (ONLY if clientName is distinct and not generic)
        const supplierConditions: any[] = [];
        const clientNameClean = (projectDoc?.clientName || '').trim();
        if (clientNameClean && !['unnati arts', 'company', 'client', 'n/a', 'na'].includes(clientNameClean.toLowerCase())) {
          supplierConditions.push({ supplier: new RegExp(`^${clientNameClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
        }
        const supplierInvs = supplierConditions.length > 0
          ? await db.collection('Inventory').find({ $or: supplierConditions }).toArray()
          : [];
        const supplierInvIds = supplierInvs.map((inv: any) => inv._id.toString());

        const pmInvIds = rawMaterials.map((m: any) => m.inventoryId?.toString()).filter(Boolean);
        const allInvIdStrings = Array.from(new Set([...pmInvIds, ...slabInvIds, ...logInvIds, ...supplierInvIds]));
        const allInvObjIds = allInvIdStrings
          .filter((invId: string) => mongoose.Types.ObjectId.isValid(invId))
          .map((invId: string) => new mongoose.Types.ObjectId(invId));

        const rawInvs = allInvIdStrings.length > 0
          ? await db.collection('Inventory').find({
              $or: [
                { _id: { $in: allInvObjIds } },
                { id: { $in: allInvIdStrings } }
              ]
            }).toArray()
          : [];

        // Fetch all InventoryLogs for these inventory items to compute Procure (+), Used (-), and Balance
        const allItemLogs = allInvIdStrings.length > 0
          ? await db.collection('InventoryLog').find({
              $or: [
                { inventoryId: { $in: allInvObjIds } },
                { inventoryId: { $in: allInvIdStrings } }
              ]
            }).sort({ createdAt: 1 }).toArray()
          : [];

        const itemLogMap = new Map<string, any[]>();
        allItemLogs.forEach((l: any) => {
          const k = l.inventoryId?.toString();
          if (!k) return;
          if (!itemLogMap.has(k)) itemLogMap.set(k, []);
          itemLogMap.get(k)!.push({ ...l, id: l._id.toString() });
        });

        const invMap = new Map();
        rawInvs.forEach((inv: any) => {
          const invKey = inv._id.toString();
          const iLogs = itemLogMap.get(invKey) || [];
          const procure = iLogs.filter((l: any) => l.type === 'IN').reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0);
          const used = iLogs.filter((l: any) => l.type === 'OUT').reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0);
          const effectiveProcure = procure > 0 ? procure : (Number(inv.quantity || 0) + used);
          invMap.set(invKey, {
            ...inv,
            id: invKey,
            procure: effectiveProcure,
            used,
            balance: Number(inv.quantity || 0),
            logs: iLogs
          });
        });

        const seenInvIds = new Set<string>();
        const enriched: any[] = [];

        rawMaterials.forEach((m: any) => {
          const invKey = m.inventoryId ? m.inventoryId.toString() : null;
          const invObj = invKey ? (invMap.get(invKey) || null) : null;
          if (!invObj) return;
          if (invKey) seenInvIds.add(invKey);
          enriched.push({
            id: m._id.toString(),
            projectId: m.projectId ? m.projectId.toString() : String(id),
            inventoryId: invKey,
            quantity: invObj.procure || m.quantity,
            procure: invObj.procure,
            used: invObj.used,
            balance: invObj.balance,
            cost: m.cost,
            addedAt: m.addedAt || invObj.createdAt,
            createdAt: m.createdAt || invObj.createdAt,
            updatedAt: m.updatedAt,
            inventory: invObj
          });
        });

        // Append any linked Inventory items that did not have an explicit ProjectMaterial row yet
        invMap.forEach((invObj: any, invKey: string) => {
          if (seenInvIds.has(invKey)) return;
          seenInvIds.add(invKey);
          enriched.push({
            id: `inv_${invKey}`,
            projectId: String(id),
            inventoryId: invKey,
            quantity: invObj.procure || invObj.balance,
            procure: invObj.procure,
            used: invObj.used,
            balance: invObj.balance,
            cost: 0,
            addedAt: invObj.createdAt,
            createdAt: invObj.createdAt,
            inventory: invObj
          });
        });

        return res.json(enriched);
      } catch (mErr) {
        console.warn('Mongoose project materials fetch failed:', mErr);
      }
    }

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
    const rawMatId = String(materialId);

    const mongoose = require('mongoose');
    const db = mongoose.connection?.db;

    if (db) {
      try {
        const isInvPrefix = rawMatId.startsWith('inv_');
        const cleanId = isInvPrefix ? rawMatId.replace('inv_', '') : rawMatId;
        const cleanObjId = mongoose.Types.ObjectId.isValid(cleanId) ? new mongoose.Types.ObjectId(cleanId) : null;

        let invIdToDel = isInvPrefix ? cleanId : null;

        if (!isInvPrefix) {
          const pmDoc = await db.collection('ProjectMaterial').findOne({
            $or: [
              ...(cleanObjId ? [{ _id: cleanObjId }] : []),
              { _id: cleanId },
              { id: cleanId }
            ]
          });
          if (pmDoc?.inventoryId) {
            invIdToDel = pmDoc.inventoryId.toString();
          }

          // Delete ProjectMaterial
          await db.collection('ProjectMaterial').deleteMany({
            $or: [
              ...(cleanObjId ? [{ _id: cleanObjId }] : []),
              { _id: cleanId },
              { id: cleanId }
            ]
          });
        }

        if (invIdToDel) {
          const invObjId = mongoose.Types.ObjectId.isValid(invIdToDel) ? new mongoose.Types.ObjectId(invIdToDel) : null;
          await db.collection('ProjectMaterial').deleteMany({
            $or: [
              ...(invObjId ? [{ inventoryId: invObjId }] : []),
              { inventoryId: invIdToDel }
            ]
          });
          await db.collection('InventoryLog').deleteMany({
            $or: [
              ...(invObjId ? [{ inventoryId: invObjId }] : []),
              { inventoryId: invIdToDel }
            ]
          });
          await db.collection('Inventory').deleteMany({
            $or: [
              ...(invObjId ? [{ _id: invObjId }] : []),
              { _id: invIdToDel },
              { id: invIdToDel }
            ]
          });
        }

        return res.json({ message: 'Material reservation and associated inventory deleted successfully' });
      } catch (mErr) {
        console.warn('Mongoose material delete fallback:', mErr);
      }
    }

    if (rawMatId.startsWith('inv_')) {
      const invId = rawMatId.replace('inv_', '');
      await prisma.projectMaterial.deleteMany({ where: { inventoryId: invId } });
      await prisma.inventoryLog.deleteMany({ where: { inventoryId: invId } });
      await prisma.inventory.deleteMany({ where: { id: invId } });
      return res.json({ message: 'Inventory and logs deleted' });
    }
    
    const pm = await prisma.projectMaterial.findUnique({ where: { id: rawMatId } });
    const invId = pm?.inventoryId;

    await prisma.projectMaterial.deleteMany({ where: { id: rawMatId } });
    if (invId) {
      await prisma.inventoryLog.deleteMany({ where: { inventoryId: invId } });
      await prisma.inventory.deleteMany({ where: { id: invId } });
    }
    
    res.json({ message: 'Material reservation and associated inventory deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error deleting material reservation' });
  }
});

export default router;


