"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get all projects
router.get('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const projects = await index_1.prisma.project.findMany({
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
                    const products = firstQuote.products;
                    if (Array.isArray(products)) {
                        calculatedTotalPieces = products.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
                    }
                }
            }
            // Completed Pieces = Total number of actual pieces that exist in the pipeline for this project
            let calculatedCompletedPieces = p.slabs?.reduce((sum, slab) => sum + (slab._count?.pieces || 0), 0) || 0;
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
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching projects' });
    }
});
// Create a new project (Enquiry)
router.get('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await index_1.prisma.project.findUnique({
            where: { id: String(id) },
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
        res.status(500).json({ message: 'Server error fetching project' });
    }
});
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { name, description, status, startDate, deadline, assignedToId, clientName, clientContact, clientEmail, enquirySource, location, requirements, createdAt, customerPhoto, totalPieces, completedPieces, deliveryDate, clientHandle } = req.body;
        // Auto-generate project ID (e.g. U-A-01) resetting per Financial Year
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-indexed (April is 3)
        const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;
        const fyStartDate = new Date(fyStartYear, 3, 1); // April 1st
        const latestProject = await index_1.prisma.project.findFirst({
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
        let exists = await index_1.prisma.project.findUnique({ where: { projectId } });
        while (exists) {
            nextNum++;
            projectId = `U-A-${String(nextNum).padStart(2, '0')}`;
            exists = await index_1.prisma.project.findUnique({ where: { projectId } });
        }
        const newProject = await index_1.prisma.project.create({
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
    }
    catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ message: 'Server error creating project' });
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
        const activeStatuses = ['shop_drawing', 'material_planning', 'production', 'work_order', 'completed'];
        if (activeStatuses.includes(project.status) && project.slabs.length === 0 && project.quotations.length > 0) {
            const firstQuote = project.quotations[0];
            if (firstQuote && firstQuote.products) {
                const products = firstQuote.products;
                for (const prod of products) {
                    const qty = Number(prod.qty) || 1;
                    for (let i = 1; i <= qty; i++) {
                        const pieceName = qty > 1 ? `${prod.category || 'Product'} ${i}` : (prod.category || 'Product');
                        const sizeStr = `${prod.length || 0}L x ${prod.width || 0}W ${prod.breadth ? `| ${prod.breadth}MM` : ''}`;
                        await index_1.prisma.slab.create({
                            data: {
                                projectId: project.id,
                                name: pieceName,
                                size: sizeStr,
                                status: 'pending'
                            }
                        });
                    }
                }
            }
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error syncing slabs:', error);
        res.status(500).json({ message: 'Server error syncing slabs' });
    }
});
// Update project (Status, workflow progression)
router.patch('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        if (updateData.startDate)
            updateData.startDate = new Date(updateData.startDate);
        if (updateData.deadline)
            updateData.deadline = new Date(updateData.deadline);
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
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error updating project' });
    }
});
// Delete project
router.delete('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // Find all slabs for this project to delete their pieces and pieceLogs
        const slabs = await index_1.prisma.slab.findMany({ where: { projectId: String(id) }, select: { id: true } });
        const slabIds = slabs.map(s => s.id);
        const pieces = await index_1.prisma.piece.findMany({ where: { slabId: { in: slabIds } }, select: { id: true } });
        const pieceIds = pieces.map(p => p.id);
        // Run deletions in a transaction to ensure everything is deleted or nothing is
        await index_1.prisma.$transaction([
            index_1.prisma.pieceLog.deleteMany({ where: { pieceId: { in: pieceIds } } }),
            index_1.prisma.piece.deleteMany({ where: { slabId: { in: slabIds } } }),
            index_1.prisma.approvalRecord.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.shopDrawing.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.design.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.quotation.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.invoice.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.productionLog.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.projectMaterial.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.machineLog.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.laborContract.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.projectClosure.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.dispatch.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.qA_QC.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.crate.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.slab.deleteMany({ where: { projectId: String(id) } }),
            index_1.prisma.project.delete({ where: { id: String(id) } })
        ]);
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
        if (!inventory || inventory.quantity < quantity) {
            return res.status(400).json({ message: 'Not enough stock in inventory' });
        }
        // Deduct stock from inventory and add to project material inside a transaction
        const [projectMaterial, updatedInventory] = await index_1.prisma.$transaction([
            index_1.prisma.projectMaterial.create({
                data: {
                    projectId: String(id),
                    inventoryId,
                    quantity: Number(quantity),
                    cost: Number(cost)
                }
            }),
            index_1.prisma.inventory.update({
                where: { id: inventoryId },
                data: { quantity: inventory.quantity - Number(quantity) }
            })
        ]);
        res.status(201).json(projectMaterial);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error reserving material' });
    }
});
exports.default = router;
//# sourceMappingURL=projectRoutes.js.map