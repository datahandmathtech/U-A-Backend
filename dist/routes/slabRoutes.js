"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const router = (0, express_1.Router)();
// Get all projects with slabs and pieces hierarchy for deduction selection
router.get('/project-hierarchy', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cacheKey = 'project_hierarchy_v2';
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const [projects, outLogs, productionLogs, pieceLogs] = await Promise.all([
            index_1.prisma.project.findMany({
                select: {
                    id: true,
                    name: true,
                    projectId: true,
                    clientName: true,
                    quotations: {
                        select: {
                            products: true
                        }
                    },
                    slabs: {
                        select: {
                            id: true,
                            name: true,
                            size: true,
                            pieces: {
                                select: {
                                    id: true,
                                    pieceNumber: true,
                                    productName: true,
                                    size: true,
                                    stage: true,
                                    status: true,
                                    sourceMaterialId: true,
                                    vendorName: true
                                }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            index_1.prisma.inventoryLog.findMany({
                where: { type: 'OUT' },
                select: { remarks: true }
            }),
            index_1.prisma.productionLog.findMany({
                select: {
                    id: true,
                    stage: true,
                    status: true,
                    approvalStatus: true,
                    slabId: true,
                    pieceIds: true,
                    productName: true
                }
            }),
            index_1.prisma.pieceLog.findMany({
                select: {
                    id: true,
                    pieceId: true,
                    status: true,
                    stage: true
                }
            })
        ]);
        const activePieceRemarks = outLogs.map(l => l.remarks || '').join(' ');
        const prodLogSlabIds = new Set();
        const prodLogPieceIds = new Set();
        const prodLogProductNames = new Set();
        for (const pl of productionLogs) {
            if (pl.slabId)
                prodLogSlabIds.add(pl.slabId);
            if (Array.isArray(pl.pieceIds)) {
                for (const pid of pl.pieceIds)
                    prodLogPieceIds.add(pid);
            }
            if (pl.productName) {
                prodLogProductNames.add(pl.productName.trim().toLowerCase());
            }
        }
        const pieceLogIds = new Set(pieceLogs.map(pl => pl.pieceId));
        const cleanProjects = projects.map(proj => {
            const products = Array.isArray(proj.quotations?.[0]?.products)
                ? proj.quotations[0].products
                : [];
            const slabsWithProduction = proj.slabs.map(slab => {
                const matchedProduct = products.find((p) => (p.category && slab.name.startsWith(p.category)) ||
                    (p.productName && (slab.name === p.productName || slab.name.startsWith(p.productName))));
                const rawUnit = (matchedProduct?.unit || (slab.size?.toLowerCase().includes('mm') ? 'mm' : (slab.size?.toLowerCase().includes('ft') ? 'feet' : 'inch'))).toLowerCase();
                const slabUnit = (rawUnit === 'sq_ft' || rawUnit === 'sqft' || rawUnit === 'sq. ft' || rawUnit === 'feet' || rawUnit === 'ft' || rawUnit.includes('sq') || rawUnit.includes('ft'))
                    ? 'feet'
                    : (rawUnit.includes('mm') ? 'mm' : 'inch');
                const piecesWithProduction = slab.pieces.map(piece => {
                    const pieceLabel = piece.productName || `Piece ${piece.pieceNumber}`;
                    const isActuallyLogged = activePieceRemarks.includes(pieceLabel);
                    const hasPLog = prodLogSlabIds.has(slab.id) ||
                        prodLogPieceIds.has(piece.id) ||
                        Boolean(piece.productName && prodLogProductNames.has(piece.productName.trim().toLowerCase()));
                    const hasPieceLog = pieceLogIds.has(piece.id);
                    const hasProduction = Boolean(hasPLog || hasPieceLog || piece.status === 'completed' || piece.status === 'active');
                    return {
                        ...piece,
                        unit: slabUnit,
                        hasProduction,
                        sourceMaterialId: isActuallyLogged ? piece.sourceMaterialId : null,
                        vendorName: isActuallyLogged ? piece.vendorName : null
                    };
                });
                const slabHasPLog = prodLogSlabIds.has(slab.id) || Array.from(prodLogProductNames).some(pName => pName.startsWith(slab.name.trim().toLowerCase()));
                const slabHasPiecesInProduction = piecesWithProduction.some(p => p.hasProduction);
                const hasProduction = Boolean(slabHasPLog || slabHasPiecesInProduction);
                const pendingPieces = piecesWithProduction.filter(p => !p.sourceMaterialId);
                return {
                    ...slab,
                    unit: slabUnit,
                    hasProduction,
                    pendingPiecesCount: pendingPieces.length,
                    pieces: piecesWithProduction
                };
            });
            return {
                ...proj,
                slabs: slabsWithProduction
            };
        });
        fastCache_1.fastCache.set(cacheKey, cleanProjects, 30);
        res.json(cleanProjects);
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching project hierarchy', error });
    }
});
// Get all distinct slab names and project/production names
router.get('/all-names', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cacheKey = 'all_names_v2';
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const [slabs, projects, pieces] = await Promise.all([
            index_1.prisma.slab.findMany({
                select: {
                    name: true,
                    project: { select: { name: true, projectId: true } }
                }
            }),
            index_1.prisma.project.findMany({
                select: { name: true, projectId: true, clientName: true }
            }),
            index_1.prisma.piece.findMany({
                select: {
                    productName: true,
                    slab: {
                        select: {
                            name: true,
                            project: { select: { name: true, projectId: true } }
                        }
                    }
                }
            })
        ]);
        const namesSet = new Set();
        // 1. Projects
        projects.forEach(p => {
            if (p.name) {
                namesSet.add(p.name);
            }
        });
        // 2. Slabs and Project - Slab combinations
        slabs.forEach(s => {
            if (s.name) {
                namesSet.add(s.name);
                if (s.project?.name) {
                    namesSet.add(`${s.project.name} - ${s.name}`);
                }
            }
        });
        // 3. Pieces / Products from production
        pieces.forEach(pc => {
            if (pc.productName) {
                namesSet.add(pc.productName);
                if (pc.slab?.project?.name) {
                    namesSet.add(`${pc.slab.project.name} - ${pc.productName}`);
                }
            }
        });
        const result = Array.from(namesSet).filter(Boolean);
        fastCache_1.fastCache.set(cacheKey, result, 60);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ message: 'Error fetching names', error });
    }
});
// Get all pieces across all slabs
router.get('/pieces', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const pieces = await index_1.prisma.piece.findMany({
            include: {
                logs: true,
                sourceMaterial: {
                    include: { inventory: true }
                },
                slab: {
                    include: {
                        project: { select: { name: true, projectId: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(pieces);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching pieces' });
    }
});
// Get slabs for a project
router.get('/project/:projectId', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;
        const cacheKey = `slabs_project_${projectId}`;
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        let slabs = [];
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (!db || mongoose.connection.readyState !== 1) {
            try {
                const directUri = process.env.DATABASE_URL || 'mongodb://yatree_admin:Mayank123@ac-n3u3fkt-shard-00-00.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net:27017,ac-n3u3fkt-shard-00-02.iuq9w0n.mongodb.net:27017/Unnati-arts?ssl=true&replicaSet=atlas-icn4hi-shard-0&authSource=admin&retryWrites=true&w=majority&readPreference=primaryPreferred';
                const conn = await mongoose.createConnection(directUri, { serverSelectionTimeoutMS: 3000 }).asPromise();
                db = conn.db;
            }
            catch (err) {
                console.warn('Could not establish dedicated Mongoose connection:', err);
            }
        }
        if (db) {
            try {
                const rawSlabs = await db.collection('Slab').find({ projectId: String(projectId) }).sort({ createdAt: 1 }).toArray();
                const slabIds = rawSlabs.map((s) => s._id.toString());
                const rawPieces = await db.collection('Piece').find({ slabId: { $in: slabIds } }).sort({ pieceNumber: 1 }).toArray();
                const pieceMap = new Map();
                rawPieces.forEach((p) => {
                    const pObj = {
                        id: p._id.toString(),
                        pieceNumber: p.pieceNumber,
                        productName: p.productName,
                        size: p.size,
                        stage: p.stage,
                        status: p.status,
                        logs: p.logs || []
                    };
                    if (!pieceMap.has(p.slabId))
                        pieceMap.set(p.slabId, []);
                    pieceMap.get(p.slabId).push(pObj);
                });
                slabs = rawSlabs.map((s) => ({
                    id: s._id.toString(),
                    projectId: s.projectId,
                    name: s.name,
                    size: s.size,
                    cost: s.cost,
                    status: s.status,
                    requiredStages: s.requiredStages,
                    createdAt: s.createdAt,
                    pieces: pieceMap.get(s._id.toString()) || []
                }));
            }
            catch (err) {
                console.warn('Mongoose slab query failed, falling back to Prisma:', err);
            }
        }
        if (slabs.length === 0) {
            slabs = await index_1.prisma.slab.findMany({
                where: { projectId: String(projectId) },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    projectId: true,
                    name: true,
                    size: true,
                    cost: true,
                    status: true,
                    requiredStages: true,
                    createdAt: true,
                    pieces: {
                        select: {
                            id: true,
                            pieceNumber: true,
                            productName: true,
                            size: true,
                            stage: true,
                            status: true,
                            logs: {
                                select: {
                                    id: true,
                                    stage: true,
                                    status: true
                                }
                            }
                        },
                        orderBy: { pieceNumber: 'asc' }
                    }
                }
            });
        }
        fastCache_1.fastCache.set(cacheKey, slabs, 60);
        res.json(slabs);
    }
    catch (error) {
        console.error('Error fetching slabs for project:', error);
        res.status(500).json({ message: 'Server error fetching slabs' });
    }
});
// Bulk create slabs (Master Maker)
router.post('/bulk-create', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, slabs } = req.body;
        if (!projectId || !Array.isArray(slabs) || slabs.length === 0) {
            return res.status(400).json({ message: 'projectId and slabs array are required' });
        }
        const createdSlabs = [];
        for (const item of slabs) {
            const slabName = item.name || 'Slab';
            const slabSize = item.size || null;
            const reqStages = item.requiredStages && Array.isArray(item.requiredStages) && item.requiredStages.length > 0
                ? item.requiredStages
                : ['Production', 'Polishing', 'Packing', 'Dispatch'];
            let piecesToCreate = [];
            if (item.pieces && Array.isArray(item.pieces) && item.pieces.length > 0) {
                piecesToCreate = item.pieces.map((p, pIdx) => ({
                    pieceNumber: p.pieceNumber ? Number(p.pieceNumber) : (pIdx + 1),
                    productName: p.productName || p.name || `${slabName}.${pIdx + 1}`,
                    size: p.size || slabSize,
                    stage: p.stage || 'Production',
                    status: 'pending'
                }));
            }
            const created = await index_1.prisma.slab.create({
                data: {
                    projectId: String(projectId),
                    name: slabName,
                    size: slabSize,
                    cost: Number(item.cost) || 0,
                    requiredStages: reqStages,
                    ...(piecesToCreate.length > 0 ? {
                        pieces: {
                            create: piecesToCreate
                        }
                    } : {})
                },
                include: {
                    pieces: true
                }
            });
            createdSlabs.push(created);
        }
        // Invalidate caches
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        res.status(201).json({ message: `Successfully created ${createdSlabs.length} slabs`, count: createdSlabs.length, slabs: createdSlabs });
    }
    catch (error) {
        console.error('Error in bulk-create slabs:', error);
        res.status(500).json({ message: 'Server error creating bulk slabs', error: error?.message || error });
    }
});
// Replicate a source slab template (its pieces, sizes, requiredStages) across target existing slabs or a range
router.post('/replicate-template', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, sourceSlabId, targetSlabIds, fromSlabNumber, toSlabNumber } = req.body;
        if (!projectId || !sourceSlabId) {
            return res.status(400).json({ message: 'projectId and sourceSlabId are required' });
        }
        // 1. Fetch source slab with its pieces
        const sourceSlab = await index_1.prisma.slab.findUnique({
            where: { id: String(sourceSlabId) },
            include: {
                pieces: {
                    orderBy: { pieceNumber: 'asc' }
                }
            }
        });
        if (!sourceSlab) {
            return res.status(404).json({ message: 'Source slab not found' });
        }
        const templatePieces = sourceSlab.pieces || [];
        // 2. Determine target slabs
        let targetSlabs = [];
        if (Array.isArray(targetSlabIds) && targetSlabIds.length > 0) {
            targetSlabs = await index_1.prisma.slab.findMany({
                where: {
                    id: { in: targetSlabIds.map(String) },
                    projectId: String(projectId)
                },
                include: { pieces: true }
            });
        }
        else if (fromSlabNumber !== undefined && toSlabNumber !== undefined) {
            const allProjectSlabs = await index_1.prisma.slab.findMany({
                where: { projectId: String(projectId) },
                orderBy: { createdAt: 'asc' },
                include: { pieces: true }
            });
            const start = Number(fromSlabNumber);
            const end = Number(toSlabNumber);
            targetSlabs = allProjectSlabs.filter((s, idx) => {
                const match = s.name.match(/\d+$/);
                const slabNum = match ? parseInt(match[0], 10) : (idx + 1);
                return slabNum >= start && slabNum <= end;
            });
        }
        if (targetSlabs.length === 0) {
            return res.status(400).json({ message: 'No target slabs found matching the criteria' });
        }
        // 3. For each target slab, clone the template pieces and update slab specs
        const updatedSlabIds = [];
        for (const targetSlab of targetSlabs) {
            if (targetSlab.id === sourceSlab.id)
                continue;
            // Update target slab specs (size, requiredStages, cost, status)
            await index_1.prisma.slab.update({
                where: { id: targetSlab.id },
                data: {
                    size: sourceSlab.size,
                    requiredStages: sourceSlab.requiredStages,
                    cost: sourceSlab.cost,
                    status: 'pending'
                }
            });
            // Delete existing pieces and piece logs for this target slab
            const oldPieceIds = (targetSlab.pieces || []).map((p) => p.id);
            if (oldPieceIds.length > 0) {
                await index_1.prisma.pieceLog.deleteMany({
                    where: { pieceId: { in: oldPieceIds } }
                }).catch(e => console.error(e));
                await index_1.prisma.piece.deleteMany({
                    where: { slabId: targetSlab.id }
                }).catch(e => console.error(e));
            }
            // Clone pieces with target slab naming
            if (templatePieces.length > 0) {
                const piecesToInsert = templatePieces.map((tp, pIdx) => {
                    const pNum = tp.pieceNumber ? Number(tp.pieceNumber) : (pIdx + 1);
                    const subName = `${targetSlab.name}.${pNum}`;
                    return {
                        slabId: targetSlab.id,
                        pieceNumber: pNum,
                        productName: subName,
                        size: tp.size || sourceSlab.size || targetSlab.size,
                        stage: 'Production',
                        status: 'pending'
                    };
                });
                await index_1.prisma.piece.createMany({ data: piecesToInsert });
            }
            updatedSlabIds.push(targetSlab.id);
        }
        // 4. Invalidate caches
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        res.json({
            success: true,
            message: `Successfully replicated ${templatePieces.length} pieces and specs to ${updatedSlabIds.length} slab(s)`,
            count: updatedSlabIds.length,
            updatedSlabIds
        });
    }
    catch (error) {
        console.error('Error replicating template to slabs:', error);
        res.status(500).json({ message: 'Server error replicating template', error: error?.message || error });
    }
});
// Create a new slab
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, inventoryId, name, size, cost, requiredStages, pieces } = req.body;
        // Optional: Deduct from inventory if inventoryId is provided
        if (inventoryId) {
            const inv = await index_1.prisma.inventory.findUnique({ where: { id: inventoryId } });
            if (inv) {
                await index_1.prisma.inventory.update({
                    where: { id: inventoryId },
                    data: { quantity: Math.max(0, inv.quantity - 1) }
                });
                await index_1.prisma.inventoryLog.create({
                    data: {
                        inventoryId: inventoryId,
                        type: 'OUT',
                        quantity: 1,
                        remarks: `Slab creation: ${name}`
                    }
                });
            }
        }
        const newSlab = await index_1.prisma.slab.create({
            data: {
                projectId,
                inventoryId: inventoryId || null,
                name,
                size,
                cost: Number(cost) || 0,
                requiredStages: requiredStages || ['Production', 'Polishing', 'Packing', 'Dispatch'],
                pieces: pieces ? { create: pieces } : undefined
            }
        });
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        res.status(201).json(newSlab);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error creating slab' });
    }
});
// Add pieces to a slab
router.post('/:id/pieces', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { count, productName, vendorName, size, piecesArray } = req.body;
        const slab = await index_1.prisma.slab.findUnique({ where: { id: String(id) }, include: { pieces: true } });
        if (!slab)
            return res.status(404).json({ message: 'Slab not found' });
        let projectMaterial = null;
        let usedQuantity = 0;
        // Auto-match source material
        const projectMaterials = await index_1.prisma.projectMaterial.findMany({
            where: { projectId: slab.projectId, isConsumed: false },
            include: { inventory: true }
        });
        if (projectMaterials.length > 0) {
            // Try to match by name
            let matched = projectMaterials.find(pm => slab.name.toLowerCase().includes(pm.inventory.itemName.toLowerCase()) ||
                pm.inventory.itemName.toLowerCase().includes(slab.name.toLowerCase()));
            // Fallback to first available if no name match
            if (!matched)
                matched = projectMaterials[0];
            projectMaterial = matched;
        }
        const currentMaxPieceNumber = slab.pieces?.length > 0
            ? Math.max(...slab.pieces.map((p) => p.pieceNumber))
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
                    pieceNumber: piecesArray[i].pieceNumber ? Number(piecesArray[i].pieceNumber) : (currentMaxPieceNumber + i + 1),
                    productName: piecesArray[i].name || productName || slab.name,
                    vendorName: vendorName || null,
                    size: piecesArray[i].size || size || null,
                    stage: 'Production',
                    status: 'pending',
                    sourceMaterialId: projectMaterial ? String(projectMaterial.id) : undefined
                });
            }
        }
        else {
            for (let i = 1; i <= Number(count); i++) {
                piecesData.push({
                    slabId: String(id),
                    pieceNumber: currentMaxPieceNumber + i,
                    productName: productName || slab.name,
                    vendorName: vendorName || null,
                    size: size || null,
                    stage: 'Production',
                    status: 'pending',
                    sourceMaterialId: projectMaterial ? String(projectMaterial.id) : undefined
                });
            }
        }
        await index_1.prisma.piece.createMany({ data: piecesData });
        if (projectMaterial) {
            const wasteQuantity = Math.max(0, projectMaterial.quantity - usedQuantity);
            await index_1.prisma.projectMaterial.update({
                where: { id: String(projectMaterial.id) },
                data: {
                    isConsumed: true,
                    usedQuantity: usedQuantity,
                    wasteQuantity: wasteQuantity
                }
            });
        }
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        fastCache_1.fastCache.invalidate('project_hierarchy_v3');
        fastCache_1.fastCache.invalidate('all_names_v2');
        const newPieces = await index_1.prisma.piece.findMany({
            where: { slabId: String(id), pieceNumber: { gt: currentMaxPieceNumber } }
        });
        res.status(201).json(newPieces);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error adding pieces' });
    }
});
// Update a slab
router.put('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, size, cost, requiredStages, status, inventoryId } = req.body;
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (size !== undefined)
            updateData.size = size;
        if (cost !== undefined)
            updateData.cost = Number(cost) || 0;
        if (status !== undefined)
            updateData.status = status;
        if (requiredStages !== undefined) {
            updateData.requiredStages = Array.isArray(requiredStages)
                ? requiredStages.map(s => String(s).trim()).filter(Boolean)
                : [];
        }
        if (inventoryId !== undefined) {
            updateData.inventoryId = (inventoryId && typeof inventoryId === 'string' && inventoryId.length === 24) ? inventoryId : null;
        }
        const updatedSlab = await index_1.prisma.slab.update({
            where: { id: String(id) },
            data: updateData
        });
        // Invalidate caches
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        res.json(updatedSlab);
    }
    catch (error) {
        console.error('Error updating slab:', error);
        res.status(500).json({ message: 'Server error updating slab', error: error?.message || error });
    }
});
// Bulk update required stages for multiple slabs
router.patch('/bulk-stages', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { slabIds, requiredStages } = req.body;
        if (!Array.isArray(slabIds) || slabIds.length === 0) {
            return res.status(400).json({ message: 'No slabs specified' });
        }
        const cleanStages = Array.isArray(requiredStages)
            ? requiredStages.map(s => String(s).trim()).filter(Boolean)
            : [];
        await index_1.prisma.slab.updateMany({
            where: { id: { in: slabIds.map(String) } },
            data: { requiredStages: cleanStages }
        });
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        res.json({ message: `Updated stages for ${slabIds.length} slabs`, count: slabIds.length });
    }
    catch (error) {
        console.error('Error bulk updating slab stages:', error);
        res.status(500).json({ message: 'Server error bulk updating slab stages', error: error?.message || error });
    }
});
// Delete a slab
router.delete('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // Find all pieces
        const pieces = await index_1.prisma.piece.findMany({ where: { slabId: String(id) } });
        const pieceIds = pieces.map(p => p.id);
        if (pieceIds.length > 0) {
            await index_1.prisma.pieceLog.deleteMany({
                where: { pieceId: { in: pieceIds } }
            }).catch(e => console.error(e));
        }
        await index_1.prisma.piece.deleteMany({
            where: { slabId: String(id) }
        }).catch(e => console.error(e));
        await index_1.prisma.slab.deleteMany({
            where: { id: String(id) }
        }).catch(e => console.error(e));
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        fastCache_1.fastCache.invalidate('project_hierarchy_v3');
        fastCache_1.fastCache.invalidate('all_names_v2');
        res.json({ message: 'Slab deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ message: 'Server error deleting slab' });
    }
});
// Piece Endpoints
// Update a Piece
router.put('/piece/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { vendorName, vendorId, size, status, productName, stage } = req.body;
        const updatedPiece = await index_1.prisma.piece.update({
            where: { id: String(req.params.id) },
            data: { vendorName, vendorId, size, status, productName, stage }
        });
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        fastCache_1.fastCache.invalidate('project_hierarchy_v3');
        fastCache_1.fastCache.invalidate('all_names_v2');
        res.json(updatedPiece);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error updating piece' });
    }
});
// Delete a Piece
router.delete('/piece/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // First delete associated logs
        await index_1.prisma.pieceLog.deleteMany({
            where: { pieceId: String(id) }
        }).catch(e => console.error(e));
        // Delete piece
        await index_1.prisma.piece.deleteMany({
            where: { id: String(id) }
        }).catch(e => console.error(e));
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        fastCache_1.fastCache.invalidate('project_hierarchy_v3');
        fastCache_1.fastCache.invalidate('all_names_v2');
        res.json({ message: 'Piece deleted successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error deleting piece' });
    }
});
// Add PieceLog (Punch In / Out / Photo)
router.post('/piece/:id/log', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { stage, status, operatorId, machineId, startPhotoUrl, endPhotoUrl, remarks, vendorName } = req.body;
        if (status === 'completed' || status === 'pending_approval') {
            const activeLog = await index_1.prisma.pieceLog.findFirst({
                where: { pieceId: req.params.id, status: 'active' },
                orderBy: { createdAt: 'desc' }
            });
            if (activeLog) {
                const updatedLog = await index_1.prisma.pieceLog.update({
                    where: { id: activeLog.id },
                    data: {
                        status: status === 'completed' ? 'completed' : 'approved',
                        endTime: new Date(),
                        endPhotoUrl,
                        remarks
                    }
                });
                await index_1.prisma.piece.update({
                    where: { id: req.params.id },
                    data: { status: 'completed' }
                });
                fastCache_1.fastCache.invalidate('slabs_project_');
                fastCache_1.fastCache.invalidate('all_projects');
                fastCache_1.fastCache.invalidate('project_hierarchy_v2');
                fastCache_1.fastCache.invalidate('project_hierarchy_v3');
                fastCache_1.fastCache.invalidate('all_names_v2');
                return res.json(updatedLog);
            }
        }
        const newLog = await index_1.prisma.pieceLog.create({
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
        await index_1.prisma.piece.update({
            where: { id: req.params.id },
            data: { stage, status: status === 'active' ? 'active' : 'pending' }
        });
        fastCache_1.fastCache.invalidate('slabs_project_');
        fastCache_1.fastCache.invalidate('all_projects');
        fastCache_1.fastCache.invalidate('project_hierarchy_v2');
        fastCache_1.fastCache.invalidate('project_hierarchy_v3');
        fastCache_1.fastCache.invalidate('all_names_v2');
        res.status(201).json(newLog);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating piece log' });
    }
});
exports.default = router;
//# sourceMappingURL=slabRoutes.js.map