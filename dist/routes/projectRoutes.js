"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get all projects
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cached = fastCache_1.fastCache.get('all_projects');
        if (cached)
            return res.json(cached);
        let enrichedProjects = [];
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const rawProjects = await db.collection('Project').find({}).sort({ createdAt: -1 }).toArray();
                const projectIds = rawProjects.map((p) => p._id.toString());
                const projectObjIds = projectIds.map((id) => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
                const [rawSlabs, rawQuotes, rawUsers] = await Promise.all([
                    db.collection('Slab').find({ $or: [{ projectId: { $in: projectIds } }, { projectId: { $in: projectObjIds } }] }).toArray(),
                    db.collection('Quotation').find({ $or: [{ projectId: { $in: projectIds } }, { projectId: { $in: projectObjIds } }] }).sort({ createdAt: -1 }).toArray(),
                    db.collection('User').find({}, { projection: { name: 1 } }).toArray()
                ]);
                const slabIds = rawSlabs.map((s) => s._id.toString());
                const slabObjIds = slabIds.map((id) => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
                const rawPieces = await db.collection('Piece').find({ $or: [{ slabId: { $in: slabIds } }, { slabId: { $in: slabObjIds } }] }).toArray();
                const userMap = new Map();
                rawUsers.forEach((u) => userMap.set(u._id.toString(), u.name));
                const quoteMap = new Map();
                rawQuotes.forEach((q) => {
                    const pId = q.projectId?.toString();
                    if (!quoteMap.has(pId))
                        quoteMap.set(pId, q);
                });
                const pieceMap = new Map();
                rawPieces.forEach((p) => {
                    const sId = p.slabId?.toString();
                    if (!pieceMap.has(sId))
                        pieceMap.set(sId, []);
                    pieceMap.get(sId).push(p);
                });
                const slabMap = new Map();
                rawSlabs.forEach((s) => {
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
                    if (!slabMap.has(pIdStr))
                        slabMap.set(pIdStr, []);
                    slabMap.get(pIdStr).push(sObj);
                });
                enrichedProjects = rawProjects.map((p) => {
                    const pId = p._id.toString();
                    const assignedName = p.assignedToId ? userMap.get(p.assignedToId) : null;
                    const firstQuote = quoteMap.get(pId);
                    let calculatedTotalPieces = p.totalPieces || 0;
                    let products = firstQuote?.products || [];
                    if (Array.isArray(products) && products.length > 0) {
                        const sum = products.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
                        if (sum > 0)
                            calculatedTotalPieces = sum;
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
                        products,
                        slabs: slabMap.get(pId) || []
                    };
                });
                fastCache_1.fastCache.set('all_projects', enrichedProjects, 60);
                return res.json(enrichedProjects);
            }
            catch (mErr) {
                console.warn('Mongoose project fetch failed, falling back to Prisma:', mErr);
            }
        }
        const projects = await index_1.prisma.project.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                assignedTo: { select: { name: true } },
                quotations: { select: { products: true }, orderBy: { createdAt: 'desc' }, take: 1 },
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
            let calculatedTotalPieces = p.totalPieces || 0;
            if (p.quotations && p.quotations.length > 0) {
                const firstQuote = p.quotations[0];
                if (firstQuote && firstQuote.products) {
                    const products = firstQuote.products;
                    if (Array.isArray(products) && products.length > 0) {
                        const sum = products.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
                        if (sum > 0)
                            calculatedTotalPieces = sum;
                    }
                }
            }
            const { quotations, ...projectData } = p;
            return {
                ...projectData,
                products: p.quotations?.[0]?.products || [],
                slabs: p.slabs || [],
                totalPieces: calculatedTotalPieces,
                completedPieces: projectData.completedPieces || 0,
                deliveryDate: projectData.deadline || projectData.deliveryDate,
                clientHandle: projectData.clientHandle || projectData.assignedTo?.name
            };
        });
        fastCache_1.fastCache.set('all_projects', enrichedProjects, 60);
        res.json(enrichedProjects);
    }
    catch (error) {
        console.error('Projects fetch error:', error);
        res.status(500).json({ message: 'Server error fetching projects' });
    }
});
// Get single project
router.get('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                let pQuery = { id: String(id) };
                if (mongoose.Types.ObjectId.isValid(id)) {
                    pQuery = { $or: [{ _id: new mongoose.Types.ObjectId(id) }, { id: String(id) }, { projectId: String(id) }] };
                }
                else {
                    pQuery = { $or: [{ id: String(id) }, { projectId: String(id) }] };
                }
                const rawProj = await db.collection('Project').findOne(pQuery);
                if (rawProj) {
                    const pId = rawProj._id.toString();
                    const pCustomId = rawProj.id || pId;
                    const [invoices, quotations, user] = await Promise.all([
                        db.collection('Invoice').find({ $or: [{ projectId: pId }, { projectId: pCustomId }] }).toArray(),
                        db.collection('Quotation').find({ $or: [{ projectId: pId }, { projectId: pCustomId }] }).sort({ createdAt: -1 }).toArray(),
                        rawProj.assignedToId ? db.collection('User').findOne({ $or: [{ _id: mongoose.Types.ObjectId.isValid(rawProj.assignedToId) ? new mongoose.Types.ObjectId(rawProj.assignedToId) : null }, { id: rawProj.assignedToId }] }, { projection: { name: 1 } }) : null
                    ]);
                    return res.json({
                        id: rawProj._id.toString(),
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
                        totalPieces: rawProj.totalPieces || 0,
                        completedPieces: rawProj.completedPieces || 0,
                        progressPercentage: rawProj.progressPercentage || 0,
                        assignedToId: rawProj.assignedToId,
                        assignedTo: user ? { name: user.name } : null,
                        clientHandle: rawProj.clientHandle || user?.name,
                        isDirectWorkOrder: rawProj.isDirectWorkOrder || false,
                        createdAt: rawProj.createdAt,
                        updatedAt: rawProj.updatedAt,
                        invoices: invoices.map((inv) => ({ ...inv, id: inv._id.toString() })),
                        quotations: quotations.map((q) => ({ ...q, id: q._id.toString() }))
                    });
                }
            }
            catch (mErr) {
                console.warn('Mongoose single project fetch failed, falling back to Prisma:', mErr);
            }
        }
        const project = await index_1.prisma.project.findFirst({
            where: {
                OR: [
                    { id: String(id) },
                    { projectId: String(id) }
                ]
            },
            include: {
                assignedTo: { select: { name: true } },
                invoices: true,
                quotations: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });
        if (!project)
            return res.status(404).json({ message: 'Project not found' });
        res.json(project);
    }
    catch (error) {
        console.error('Error fetching project by id:', error);
        res.status(500).json({ message: 'Server error fetching project' });
    }
});
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { name, description, status, startDate, deadline, assignedToId, clientName, clientContact, clientEmail, enquirySource, location, requirements, createdAt, customerPhoto, totalPieces, completedPieces, deliveryDate, clientHandle, isDirectWorkOrder } = req.body;
        // Auto-generate project ID (e.g. U-A-01, U-A-13) safely in a single scan
        const allProjects = await index_1.prisma.project.findMany({
            select: { projectId: true }
        });
        let maxNum = 0;
        allProjects.forEach(p => {
            const match = p.projectId ? p.projectId.match(/U-A-(\d+)/) : null;
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                if (num > maxNum)
                    maxNum = num;
            }
        });
        const nextNum = maxNum + 1;
        const projectId = `U-A-${String(nextNum).padStart(2, '0')}`;
        const finalName = (name && name.trim()) ? name.trim() : `${(clientName || 'New Client').trim()} - Enquiry`;
        const newProject = await index_1.prisma.project.create({
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
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('dashboard_summary');
        res.status(201).json(newProject);
    }
    catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ message: 'Server error creating project', error: error?.message || error });
    }
});
// Sync slabs from quotation (for backward compatibility / stuck projects)
router.post('/:id/sync-slabs', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await index_1.prisma.project.findUnique({
            where: { id: String(id) },
            include: { slabs: true, quotations: { orderBy: { createdAt: 'desc' } } }
        });
        if (!project)
            return res.status(404).json({ message: 'Project not found' });
        const existingSlabs = await index_1.prisma.slab.findMany({ where: { projectId: String(id) }, select: { name: true } });
        const existingNames = new Set(existingSlabs.map(s => s.name));
        const desiredSlabs = [];
        if (project.quotations.length > 0) {
            const firstQuote = project.quotations[0];
            if (firstQuote && firstQuote.products) {
                const products = firstQuote.products;
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
        const fullExistingSlabs = await index_1.prisma.slab.findMany({ where: { projectId: String(id) } });
        const slabMap = new Map(fullExistingSlabs.map(s => [s.name, s]));
        for (const desired of desiredSlabs) {
            if (!slabMap.has(desired.name)) {
                await index_1.prisma.slab.create({
                    data: {
                        projectId: project.id,
                        name: desired.name,
                        size: desired.size,
                        status: 'pending'
                    }
                });
                slabMap.set(desired.name, { name: desired.name });
                addedCount++;
            }
            else {
                // Update size if it has changed
                const existing = slabMap.get(desired.name);
                if (existing && existing.size !== desired.size) {
                    await index_1.prisma.slab.update({
                        where: { id: existing.id },
                        data: { size: desired.size }
                    });
                    updatedCount++;
                }
            }
        }
        res.json({ message: 'Synced new slabs.' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error syncing slabs' });
    }
});
// Update project (Status, workflow progression)
router.patch('/:id', authMiddleware_1.authenticate, async (req, res) => {
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
        const updateData = {};
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
        if (updateData.startDate)
            updateData.startDate = new Date(updateData.startDate);
        if (updateData.deadline)
            updateData.deadline = new Date(updateData.deadline);
        if (updateData.deliveryDate)
            updateData.deliveryDate = new Date(updateData.deliveryDate);
        if (updateData.totalPieces !== undefined)
            updateData.totalPieces = parseInt(updateData.totalPieces) || 0;
        if (updateData.completedPieces !== undefined)
            updateData.completedPieces = parseInt(updateData.completedPieces) || 0;
        const updated = await index_1.prisma.project.update({
            where: { id: String(id) },
            data: updateData,
            include: { slabs: true, quotations: { orderBy: { createdAt: 'desc' } } }
        });
        // Auto-generate Slabs and Pieces if transitioning to an active work order stage from quotation
        const activeStatuses = ['shop_drawing', 'material_planning', 'production', 'work_order', 'completed'];
        if (updateData.status && activeStatuses.includes(updateData.status) && updated.slabs.length === 0 && updated.quotations.length > 0) {
            const firstQuote = updated.quotations[0];
            if (firstQuote && firstQuote.products) {
                const products = firstQuote.products;
                for (const prod of products) {
                    const qty = Number(prod.qty) || 1;
                    for (let i = 1; i <= qty; i++) {
                        const pieceName = qty > 1 ? `${prod.category || 'Product'} ${i}` : (prod.category || 'Product');
                        const sizeStr = `${prod.length || 0}L x ${prod.width || 0}W ${prod.breadth ? `| ${prod.breadth}MM` : ''}`;
                        await index_1.prisma.slab.create({
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
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('dashboard_summary');
        res.json(updated);
    }
    catch (error) {
        console.error("Error updating project:", error);
        res.status(500).json({ message: error.message || 'Server error updating project' });
    }
});
// Delete project
router.delete('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // Find project by id (ObjectId) or projectId (string identifier)
        const existingProject = await index_1.prisma.project.findFirst({
            where: {
                OR: [
                    { id: String(id) },
                    { projectId: String(id) }
                ]
            }
        });
        if (!existingProject) {
            fastCache_1.fastCache.invalidate('all_projects');
            fastCache_1.fastCache.invalidate('dashboard_summary');
            fastCache_1.fastCache.invalidate('project_hierarchy_v2');
            fastCache_1.fastCache.invalidate('project_hierarchy_v3');
            fastCache_1.fastCache.invalidate('all_names_v2');
            return res.json({ message: 'Project deleted or does not exist' });
        }
        const realId = existingProject.id;
        // Find all slabs for this project to delete their pieces and pieceLogs
        const slabs = await index_1.prisma.slab.findMany({ where: { projectId: realId }, select: { id: true } });
        const slabIds = slabs.map(s => s.id);
        const pieces = await index_1.prisma.piece.findMany({ where: { slabId: { in: slabIds } }, select: { id: true } });
        const pieceIds = pieces.map(p => p.id);
        // Delete child dependencies safely
        if (pieceIds.length > 0) {
            await index_1.prisma.pieceLog.deleteMany({ where: { pieceId: { in: pieceIds } } }).catch(e => console.error("pieceLog del error:", e));
        }
        if (slabIds.length > 0) {
            await index_1.prisma.piece.deleteMany({ where: { slabId: { in: slabIds } } }).catch(e => console.error("piece del error:", e));
            await index_1.prisma.slab.deleteMany({ where: { id: { in: slabIds } } }).catch(e => console.error("slab del error:", e));
        }
        await index_1.prisma.approvalRecord.deleteMany({ where: { projectId: realId } }).catch(e => console.error("approvalRecord del error:", e));
        await index_1.prisma.shopDrawing.deleteMany({ where: { projectId: realId } }).catch(e => console.error("shopDrawing del error:", e));
        await index_1.prisma.design.deleteMany({ where: { projectId: realId } }).catch(e => console.error("design del error:", e));
        await index_1.prisma.quotation.deleteMany({ where: { projectId: realId } }).catch(e => console.error("quotation del error:", e));
        await index_1.prisma.invoice.deleteMany({ where: { projectId: realId } }).catch(e => console.error("invoice del error:", e));
        await index_1.prisma.productionLog.deleteMany({ where: { projectId: realId } }).catch(e => console.error("productionLog del error:", e));
        await index_1.prisma.projectMaterial.deleteMany({ where: { projectId: realId } }).catch(e => console.error("projectMaterial del error:", e));
        await index_1.prisma.machineLog.deleteMany({ where: { projectId: realId } }).catch(e => console.error("machineLog del error:", e));
        await index_1.prisma.laborContract.deleteMany({ where: { projectId: realId } }).catch(e => console.error("laborContract del error:", e));
        await index_1.prisma.projectClosure.deleteMany({ where: { projectId: realId } }).catch(e => console.error("projectClosure del error:", e));
        await index_1.prisma.crate.deleteMany({ where: { projectId: realId } }).catch(e => console.error("crate del error:", e));
        await index_1.prisma.dispatch.deleteMany({ where: { projectId: realId } }).catch(e => console.error("dispatch del error:", e));
        await index_1.prisma.qA_QC.deleteMany({ where: { projectId: realId } }).catch(e => console.error("qA_QC del error:", e));
        await index_1.prisma.project.deleteMany({
            where: {
                OR: [
                    { id: realId },
                    { projectId: String(id) }
                ]
            }
        });
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('dashboard_summary');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        fastCache_1.fastCache.invalidate('project_hierarchy_v3');
        fastCache_1.fastCache.invalidate('all_names_v2');
        res.json({ message: 'Project and all related entries deleted successfully' });
    }
    catch (error) {
        console.error("Delete Project Error:", error);
        res.status(500).json({ message: error.message || 'Server error deleting project' });
    }
});
// Get materials reserved for project
router.get('/:id/materials', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const pObjId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
                const rawMaterials = await db.collection('ProjectMaterial').find({
                    $or: [
                        { projectId: String(id) },
                        ...(pObjId ? [{ projectId: pObjId }] : [])
                    ]
                }).sort({ addedAt: -1 }).toArray();
                const invIds = rawMaterials.map((m) => m.inventoryId).filter(Boolean);
                const invObjIds = invIds.filter((invId) => mongoose.Types.ObjectId.isValid(invId)).map((invId) => new mongoose.Types.ObjectId(invId));
                const rawInvs = await db.collection('Inventory').find({
                    $or: [
                        { _id: { $in: invObjIds } },
                        { id: { $in: invIds } }
                    ]
                }).toArray();
                const invMap = new Map();
                rawInvs.forEach((inv) => invMap.set(inv._id.toString(), { ...inv, id: inv._id.toString() }));
                const enriched = rawMaterials.map((m) => ({
                    id: m._id.toString(),
                    projectId: m.projectId ? m.projectId.toString() : String(id),
                    inventoryId: m.inventoryId ? m.inventoryId.toString() : null,
                    quantity: m.quantity,
                    cost: m.cost,
                    addedAt: m.addedAt,
                    createdAt: m.createdAt,
                    updatedAt: m.updatedAt,
                    inventory: m.inventoryId ? (invMap.get(m.inventoryId.toString()) || null) : null
                }));
                return res.json(enriched);
            }
            catch (mErr) {
                console.warn('Mongoose project materials fetch failed:', mErr);
            }
        }
        const materials = await index_1.prisma.projectMaterial.findMany({
            where: { projectId: String(id) },
            include: { inventory: true },
            orderBy: { addedAt: 'desc' }
        });
        res.json(materials);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching project materials' });
    }
});
// Reserve material for project
router.post('/:id/materials', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { inventoryId, quantity, cost } = req.body;
        // Check inventory stock
        const inventory = await index_1.prisma.inventory.findUnique({ where: { id: inventoryId } });
        if (!inventory) {
            return res.status(400).json({ message: 'Inventory item not found' });
        }
        // Do not deduct stock from global inventory here. It gets deducted when the piece is Approved in production.
        const projectMaterial = await index_1.prisma.projectMaterial.create({
            data: {
                projectId: String(id),
                inventoryId,
                quantity: Number(quantity),
                cost: Number(cost)
            }
        });
        res.status(201).json(projectMaterial);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error reserving material' });
    }
});
// Delete reserved material from project
router.delete('/:id/materials/:materialId', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { materialId } = req.params;
        const pm = await index_1.prisma.projectMaterial.findUnique({ where: { id: String(materialId) } });
        if (!pm)
            return res.status(404).json({ message: 'Material reservation not found' });
        const invId = pm.inventoryId;
        await index_1.prisma.$transaction([
            index_1.prisma.projectMaterial.delete({ where: { id: String(materialId) } }),
            index_1.prisma.inventoryLog.deleteMany({ where: { inventoryId: invId } }),
            index_1.prisma.inventory.delete({ where: { id: invId } })
        ]);
        res.json({ message: 'Material reservation and associated inventory deleted' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error deleting material reservation' });
    }
});
exports.default = router;
//# sourceMappingURL=projectRoutes.js.map