"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const fastCache_1 = require("../utils/fastCache");
const projectSync_1 = require("../utils/projectSync");
const router = (0, express_1.Router)();
// Get all projects with slabs and pieces hierarchy for deduction selection
router.get('/project-hierarchy', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const cacheKey = 'project_hierarchy_v3';
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const [rawProjects, rawQuotes, rawSlabs, rawPieces, rawOutLogs, rawProdLogs, rawPieceLogs] = await Promise.all([
                    db.collection('Project').find({}).sort({ createdAt: -1 }).toArray(),
                    db.collection('Quotation').find({}).sort({ createdAt: -1 }).toArray(),
                    db.collection('Slab').find({}).toArray(),
                    db.collection('Piece').find({}).toArray(),
                    db.collection('InventoryLog').find({ type: 'OUT' }, { projection: { remarks: 1 } }).toArray(),
                    db.collection('ProductionLog').find({}, { projection: { id: 1, stage: 1, status: 1, approvalStatus: 1, slabId: 1, pieceIds: 1, productName: 1 } }).toArray(),
                    db.collection('PieceLog').find({}, { projection: { id: 1, pieceId: 1, status: 1, stage: 1 } }).toArray()
                ]);
                const quoteMap = new Map();
                rawQuotes.forEach((q) => {
                    const pKey = q.projectId?.toString();
                    if (!quoteMap.has(pKey))
                        quoteMap.set(pKey, q);
                });
                const pieceMap = new Map();
                rawPieces.forEach((p) => {
                    const sKey = p.slabId?.toString();
                    if (!pieceMap.has(sKey))
                        pieceMap.set(sKey, []);
                    pieceMap.get(sKey).push({
                        id: p._id.toString(),
                        pieceNumber: p.pieceNumber,
                        productName: p.productName,
                        size: p.size,
                        stage: p.stage,
                        status: p.status,
                        sourceMaterialId: p.sourceMaterialId,
                        vendorName: p.vendorName
                    });
                });
                const slabMap = new Map();
                rawSlabs.forEach((s) => {
                    const pKey = s.projectId?.toString();
                    if (!slabMap.has(pKey))
                        slabMap.set(pKey, []);
                    slabMap.get(pKey).push({
                        id: s._id.toString(),
                        name: s.name,
                        size: s.size,
                        pieces: pieceMap.get(s._id.toString()) || []
                    });
                });
                const activePieceRemarks = rawOutLogs.map((l) => l.remarks || '').join(' ');
                const prodLogSlabIds = new Set();
                const prodLogPieceIds = new Set();
                const prodLogProductNames = new Set();
                for (const pl of rawProdLogs) {
                    if (pl.slabId)
                        prodLogSlabIds.add(pl.slabId.toString());
                    if (Array.isArray(pl.pieceIds)) {
                        for (const pid of pl.pieceIds)
                            prodLogPieceIds.add(pid?.toString());
                    }
                    if (pl.productName) {
                        prodLogProductNames.add(pl.productName.trim().toLowerCase());
                    }
                }
                const pieceLogIds = new Set(rawPieceLogs.map((pl) => pl.pieceId?.toString()));
                const cleanProjects = rawProjects.map((proj) => {
                    const pId = proj._id.toString();
                    const firstQuote = quoteMap.get(pId);
                    const products = Array.isArray(firstQuote?.products) ? firstQuote.products : [];
                    const projSlabs = slabMap.get(pId) || [];
                    const slabsWithProduction = projSlabs.map((slab) => {
                        const matchedProduct = products.find((p) => (p.category && slab.name.startsWith(p.category)) ||
                            (p.productName && (slab.name === p.productName || slab.name.startsWith(p.productName))));
                        const pUnit = (matchedProduct?.unit || '').toLowerCase();
                        const pDimUnit = (matchedProduct?.dimensionUnit || '').toLowerCase();
                        let rawUnit = '';
                        if (pUnit.startsWith('piece') || pUnit === 'pcs') {
                            rawUnit = pDimUnit || '';
                        }
                        else if (pUnit) {
                            rawUnit = pUnit;
                        }
                        const sizeLower = `${slab.size || ''} ${slab.pieces?.[0]?.size || ''}`.toLowerCase();
                        if (!rawUnit || rawUnit === 'inch') {
                            if (sizeLower.includes('(mm)') || sizeLower.includes('mm')) {
                                rawUnit = 'mm';
                            }
                            else if (sizeLower.includes('(ft)') || sizeLower.includes('ft') || sizeLower.includes('feet')) {
                                rawUnit = 'feet';
                            }
                        }
                        const slabUnit = (rawUnit === 'sq_ft' || rawUnit === 'sqft' || rawUnit === 'sq. ft' || rawUnit === 'feet' || rawUnit === 'ft' || rawUnit.includes('sq') || rawUnit.includes('ft'))
                            ? 'feet'
                            : (rawUnit.includes('mm') ? 'mm' : 'inch');
                        const piecesWithProduction = slab.pieces.map((piece) => {
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
                        const slabHasPiecesInProduction = piecesWithProduction.some((p) => p.hasProduction);
                        const hasProduction = Boolean(slabHasPLog || slabHasPiecesInProduction);
                        const pendingPieces = piecesWithProduction.filter((p) => !p.sourceMaterialId);
                        return {
                            ...slab,
                            unit: slabUnit,
                            hasProduction,
                            pendingPiecesCount: pendingPieces.length,
                            pieces: piecesWithProduction
                        };
                    });
                    return {
                        id: pId,
                        name: proj.name,
                        projectId: proj.projectId,
                        clientName: proj.clientName,
                        quotations: firstQuote ? [{ products }] : [],
                        slabs: slabsWithProduction
                    };
                });
                fastCache_1.fastCache.set(cacheKey, cleanProjects, 30);
                return res.json(cleanProjects);
            }
            catch (mErr) {
                console.warn('Mongoose project hierarchy query failed:', mErr);
            }
        }
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
                const pUnit = (matchedProduct?.unit || '').toLowerCase();
                const pDimUnit = (matchedProduct?.dimensionUnit || '').toLowerCase();
                let rawUnit = '';
                if (pUnit.startsWith('piece') || pUnit === 'pcs') {
                    rawUnit = pDimUnit || '';
                }
                else if (pUnit) {
                    rawUnit = pUnit;
                }
                const sizeLower = `${slab.size || ''} ${slab.pieces?.[0]?.size || ''}`.toLowerCase();
                if (!rawUnit || rawUnit === 'inch') {
                    if (sizeLower.includes('(mm)') || sizeLower.includes('mm')) {
                        rawUnit = 'mm';
                    }
                    else if (sizeLower.includes('(ft)') || sizeLower.includes('ft') || sizeLower.includes('feet')) {
                        rawUnit = 'feet';
                    }
                }
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
        const cacheKey = `slabs_project_v3_${projectId}`;
        const cached = fastCache_1.fastCache.get(cacheKey);
        if (cached)
            return res.json(cached);
        let slabs = [];
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (db) {
            try {
                const slabProjObjId = mongoose.Types.ObjectId.isValid(projectId) ? new mongoose.Types.ObjectId(projectId) : null;
                const slabProjFilter = slabProjObjId
                    ? { $or: [{ projectId: String(projectId) }, { projectId: slabProjObjId }] }
                    : { projectId: String(projectId) };
                const rawSlabs = await db.collection('Slab').find(slabProjFilter).sort({ createdAt: 1 }).toArray();
                const slabIds = rawSlabs.map((s) => s._id.toString());
                const slabObjIds = rawSlabs.map((s) => s._id);
                const rawPieces = await db.collection('Piece').find({
                    $or: [
                        { slabId: { $in: slabIds } },
                        { slabId: { $in: slabObjIds } }
                    ]
                }).sort({ pieceNumber: 1 }).toArray();
                const pieceIds = rawPieces.map((p) => p._id.toString());
                const pieceObjIds = rawPieces.map((p) => p._id);
                const rawPieceLogs = await db.collection('PieceLog').find({
                    $or: [
                        { pieceId: { $in: pieceIds } },
                        { pieceId: { $in: pieceObjIds } }
                    ]
                }).sort({ createdAt: -1 }).toArray();
                const pieceLogMap = new Map();
                const seenPieceStageKey = new Set();
                const duplicatePieceLogIds = [];
                rawPieceLogs.forEach((l) => {
                    const pk = l.pieceId?.toString();
                    if (!pk)
                        return;
                    const rawStg = String(l.stage || 'Production').replace(' Work', '').trim();
                    const normStage = rawStg.startsWith('Polishing') ? 'Polishing' : (rawStg.startsWith('Bridge Cutting') ? 'Bridge Cutting' : rawStg);
                    const dedupKey = `${pk}__${normStage.toLowerCase()}`;
                    if (!pieceLogMap.has(pk))
                        pieceLogMap.set(pk, []);
                    let effectiveEndTime = l.endTime || l.createdAt || null;
                    let effectiveStartTime = l.startTime || null;
                    if (l.endTime && l.createdAt && new Date(l.endTime).getTime() - new Date(l.createdAt).getTime() > 60000) {
                        effectiveEndTime = l.createdAt;
                        db.collection('PieceLog').updateOne({ _id: l._id }, { $set: { endTime: l.createdAt } }).catch(() => { });
                    }
                    if (l.startTime && l.createdAt && new Date(l.startTime).getTime() - new Date(l.createdAt).getTime() > 60000) {
                        effectiveStartTime = l.createdAt;
                        db.collection('PieceLog').updateOne({ _id: l._id }, { $set: { startTime: l.createdAt } }).catch(() => { });
                    }
                    if (seenPieceStageKey.has(dedupKey)) {
                        const existingEntry = pieceLogMap.get(pk).find((x) => x.stage === normStage);
                        if (existingEntry) {
                            if (!existingEntry.endPhotoUrl && (l.endPhotoUrl || l.startPhotoUrl)) {
                                existingEntry.endPhotoUrl = l.endPhotoUrl || l.startPhotoUrl;
                                existingEntry.startPhotoUrl = l.startPhotoUrl || l.endPhotoUrl;
                            }
                            if (!existingEntry.machineId && l.machineId) {
                                existingEntry.machineId = l.machineId.toString();
                            }
                        }
                        duplicatePieceLogIds.push(l._id);
                        return;
                    }
                    seenPieceStageKey.add(dedupKey);
                    pieceLogMap.get(pk).push({
                        id: l._id.toString(),
                        stage: normStage,
                        status: l.status,
                        machineId: l.machineId?.toString() || null,
                        driverName: l.driverName || null,
                        startPhotoUrl: l.startPhotoUrl || null,
                        endPhotoUrl: l.endPhotoUrl || null,
                        remarks: l.remarks || null,
                        startTime: effectiveStartTime,
                        endTime: effectiveEndTime,
                        createdAt: l.createdAt
                    });
                });
                if (duplicatePieceLogIds.length > 0) {
                    db.collection('PieceLog').deleteMany({ _id: { $in: duplicatePieceLogIds } }).catch(() => { });
                }
                const sourceMatIds = rawPieces.map((p) => p.sourceMaterialId).filter(Boolean);
                const sourceMatObjIds = sourceMatIds
                    .filter((id) => mongoose.Types.ObjectId.isValid(id?.toString()))
                    .map((id) => new mongoose.Types.ObjectId(id.toString()));
                const allSourceMatLookup = Array.from(new Set([...sourceMatIds.map((id) => id.toString()), ...sourceMatObjIds]));
                const slabInvIds = rawSlabs.map((s) => s.inventoryId).filter(Boolean);
                const rawProjMats = allSourceMatLookup.length > 0
                    ? await db.collection('ProjectMaterial').find({
                        $or: [
                            { _id: { $in: allSourceMatLookup } },
                            { id: { $in: sourceMatIds.map((id) => id.toString()) } }
                        ]
                    }).toArray()
                    : [];
                const invIds = Array.from(new Set([
                    ...rawProjMats.map((pm) => pm.inventoryId).filter(Boolean),
                    ...slabInvIds
                ]));
                const invObjIds = invIds
                    .filter((id) => mongoose.Types.ObjectId.isValid(id?.toString()))
                    .map((id) => new mongoose.Types.ObjectId(id.toString()));
                const allInvLookup = Array.from(new Set([...invIds.map((id) => id.toString()), ...invObjIds]));
                const rawInvs = allInvLookup.length > 0
                    ? await db.collection('Inventory').find({
                        $or: [
                            { _id: { $in: allInvLookup } },
                            { id: { $in: invIds.map((id) => id.toString()) } }
                        ]
                    }).toArray()
                    : [];
                const invMap = new Map();
                rawInvs.forEach((inv) => {
                    invMap.set(inv._id.toString(), {
                        id: inv._id.toString(),
                        itemName: inv.itemName,
                        blockNumber: inv.blockNumber,
                        length: inv.length,
                        width: inv.width,
                        thickness: inv.thickness,
                        unit: inv.unit,
                        jobWorkType: inv.jobWorkType,
                        supplier: inv.supplier
                    });
                });
                const projMatMap = new Map();
                rawProjMats.forEach((pm) => {
                    const invKey = pm.inventoryId?.toString();
                    projMatMap.set(pm._id.toString(), {
                        id: pm._id.toString(),
                        projectId: pm.projectId?.toString(),
                        inventoryId: invKey,
                        quantity: pm.quantity,
                        usedQuantity: pm.usedQuantity,
                        inventory: invMap.get(invKey) || null
                    });
                });
                const slabSizeMap = new Map();
                rawSlabs.forEach((s) => {
                    slabSizeMap.set(s._id.toString(), s.size || '');
                });
                const pieceMap = new Map();
                rawPieces.forEach((p) => {
                    const smId = p.sourceMaterialId?.toString();
                    const pLogs = pieceLogMap.get(p._id.toString()) || [];
                    const parentSlabSize = slabSizeMap.get(p.slabId?.toString()) || '';
                    const parentSlabArea = (0, projectSync_1.parsePieceAreaSqFt)(parentSlabSize);
                    let effectivePieceSize = p.size;
                    if (parentSlabArea > 0 && effectivePieceSize) {
                        const pArea = (0, projectSync_1.parsePieceAreaSqFt)(effectivePieceSize);
                        if (pArea > parentSlabArea + 0.05) {
                            // Auto-heal piece whose unit was accidentally set to Feet inside an Inch/MM slab (e.g. 300 Sq.Ft inside 4.17 Sq.Ft slab)
                            const lMatch = String(effectivePieceSize).match(/(\d+(?:\.\d+)?)\s*L/i);
                            const wMatch = String(effectivePieceSize).match(/(\d+(?:\.\d+)?)\s*W/i);
                            const tMatch = String(effectivePieceSize).match(/\|\s*(\d+(?:\.\d+)?)\s*MM/i);
                            if (lMatch && wMatch) {
                                const lNum = parseFloat(lMatch[1] || '0');
                                const wNum = parseFloat(wMatch[1] || '0');
                                const parentLower = parentSlabSize.toLowerCase();
                                const isParentMM = parentLower.includes('mm') && !parentLower.includes('inch') && !parentLower.includes('feet');
                                const isParentFt = parentLower.includes('feet') || parentLower.includes('ft');
                                const repairedUnit = isParentMM ? 'MM' : (isParentFt ? 'Feet' : 'Inch');
                                const repairedArea = isParentMM ? ((lNum * wNum) / 92903.04) : (isParentFt ? (lNum * wNum) : ((lNum * wNum) / 144));
                                if (repairedArea <= parentSlabArea + 0.05) {
                                    effectivePieceSize = `${lNum}L x ${wNum}W ${repairedUnit}${tMatch ? ` | ${tMatch[1]}MM` : ''} (${repairedArea.toFixed(2)} Sq.Ft)`;
                                    db.collection('Piece').updateOne({ _id: p._id }, { $set: { size: effectivePieceSize } }).catch(() => { });
                                }
                            }
                        }
                    }
                    let pieceStage = p.stage || 'Production';
                    let pieceStatus = p.status || 'pending';
                    // Auto-reconcile orphan Packing/Dispatch pieces if their log was deleted
                    const normStage = (pieceStage || '').replace(' Work', '').trim();
                    if (normStage === 'Packing' || normStage === 'Dispatch') {
                        const hasApprovedLog = pLogs.some((l) => {
                            const lStage = (l.stage || '').replace(' Work', '').trim();
                            return (lStage === normStage || lStage.startsWith(normStage)) && (l.status === 'approved' || l.status === 'completed');
                        });
                        if (!hasApprovedLog) {
                            pieceStatus = 'pending';
                            const hasPolishingLog = pLogs.some((l) => (l.stage || '').startsWith('Polishing'));
                            pieceStage = hasPolishingLog ? 'Polishing' : 'Production';
                            db.collection('Piece').updateOne({ _id: p._id }, { $set: { status: 'pending', stage: pieceStage } }).catch(() => { });
                        }
                    }
                    const pObj = {
                        id: p._id.toString(),
                        pieceNumber: p.pieceNumber,
                        productName: p.productName,
                        size: effectivePieceSize,
                        stage: pieceStage,
                        status: pieceStatus,
                        sourceMaterialId: smId || null,
                        vendorName: p.vendorName || null,
                        sourceMaterial: smId ? (projMatMap.get(smId) || null) : null,
                        logs: pLogs
                    };
                    const sKey = p.slabId?.toString();
                    if (!pieceMap.has(sKey))
                        pieceMap.set(sKey, []);
                    pieceMap.get(sKey).push(pObj);
                });
                // Changes 1 & 2: Auto-create 1 inside piece for any single slab that has 0 pieces
                for (const s of rawSlabs) {
                    const sKey = s._id.toString();
                    const existingPieces = pieceMap.get(sKey) || [];
                    if (existingPieces.length === 0) {
                        const isSlabCompleted = s.status === 'completed' || s.status === 'approved';
                        const newPieceId = new mongoose.Types.ObjectId();
                        const pieceName = `${s.name || 'Slab'}.1`;
                        const nowDate = new Date();
                        const newPieceDoc = {
                            _id: newPieceId,
                            slabId: s._id,
                            pieceNumber: 1,
                            productName: pieceName,
                            size: s.size || '',
                            stage: 'Production',
                            status: isSlabCompleted ? 'completed' : 'pending',
                            createdAt: s.createdAt || nowDate,
                            updatedAt: nowDate
                        };
                        await db.collection('Piece').insertOne(newPieceDoc).catch(() => { });
                        const autoLogs = [];
                        if (isSlabCompleted) {
                            const reqStages = Array.isArray(s.requiredStages) && s.requiredStages.length > 0
                                ? s.requiredStages.filter((st) => st !== 'Polishing' && st !== 'Packing' && st !== 'Dispatch')
                                : ['Production'];
                            const stagesToLog = reqStages.length > 0 ? reqStages : ['Production'];
                            for (const stg of stagesToLog) {
                                const normStg = stg.startsWith('Polishing') ? 'Polishing' : stg;
                                const newLogId = new mongoose.Types.ObjectId();
                                const logDoc = {
                                    _id: newLogId,
                                    pieceId: newPieceId,
                                    stage: normStg,
                                    status: 'approved',
                                    remarks: 'Auto-synced from Single Slab Approval',
                                    endTime: nowDate,
                                    createdAt: nowDate,
                                    updatedAt: nowDate
                                };
                                await db.collection('PieceLog').insertOne(logDoc).catch(() => { });
                                autoLogs.push({
                                    id: newLogId.toString(),
                                    stage: normStg,
                                    status: 'approved',
                                    remarks: 'Auto-synced from Single Slab Approval',
                                    createdAt: nowDate
                                });
                            }
                        }
                        pieceMap.set(sKey, [{
                                id: newPieceId.toString(),
                                pieceNumber: 1,
                                productName: pieceName,
                                size: s.size || '',
                                stage: 'Production',
                                status: isSlabCompleted ? 'completed' : 'pending',
                                sourceMaterialId: null,
                                vendorName: null,
                                sourceMaterial: null,
                                logs: autoLogs
                            }]);
                    }
                }
                slabs = rawSlabs.map((s) => {
                    const slabInvKey = s.inventoryId?.toString();
                    const slabPieces = pieceMap.get(s._id.toString()) || [];
                    const slabIsFeet = /\bfeet\b/i.test((s.size || '').split('|')[0] || '');
                    if (slabIsFeet && Array.isArray(slabPieces)) {
                        slabPieces.forEach((p) => {
                            if (p.size && /\binch\b/i.test(p.size) && !/\(\s*[\d.]+\s*Sq\.?Ft\s*\)/i.test(p.size)) {
                                const lM = p.size.match(/([\d.]+)\s*L/i);
                                const wM = p.size.match(/([\d.]+)\s*W/i);
                                const lVal = lM && lM[1] ? parseFloat(lM[1]) : 0;
                                const wVal = wM && wM[1] ? parseFloat(wM[1]) : 0;
                                const areaStr = (lVal > 0 && wVal > 0) ? ` (${(lVal * wVal).toFixed(2)} Sq.Ft)` : '';
                                p.size = p.size.replace(/\binch\b/i, 'Feet') + areaStr;
                                index_1.prisma.piece.update({ where: { id: p.id }, data: { size: p.size } }).catch(() => { });
                            }
                        });
                    }
                    // Auto-heal slab whose size is MM but either missing unit or erroneously labeled Inch
                    const lMatch = (s.size || '').match(/([\d.]+)\s*L/i);
                    const wMatch = (s.size || '').match(/([\d.]+)\s*W/i);
                    const tMatch = (s.size || '').match(/\|\s*([\d.]+)\s*MM/i) || (s.size || '').match(/([\d.]+)\s*MM/i);
                    if (lMatch && wMatch) {
                        const lVal = parseFloat(lMatch[1] || '0');
                        const wVal = parseFloat(wMatch[1] || '0');
                        const tVal = tMatch ? tMatch[1] : '18';
                        if (lVal > 150 || wVal > 150) {
                            const mmSqFt = ((lVal * wVal) / 92903.04).toFixed(2);
                            const properSize = `${lVal}L x ${wVal}W MM | ${tVal}MM (${mmSqFt} Sq.Ft)`;
                            if (s.size !== properSize) {
                                s.size = properSize;
                                db.collection('Slab').updateOne({ _id: s._id }, { $set: { size: properSize } }).catch(() => { });
                            }
                        }
                    }
                    const rawReqStages = Array.isArray(s.requiredStages) && s.requiredStages.length > 0
                        ? s.requiredStages.filter((st) => st !== 'Polishing')
                        : ['Production'];
                    const cleanReqStages = rawReqStages.length > 0 ? rawReqStages : ['Production'];
                    return {
                        id: s._id.toString(),
                        projectId: s.projectId?.toString() || s.projectId,
                        inventoryId: slabInvKey || null,
                        inventory: slabInvKey ? (invMap.get(slabInvKey) || null) : null,
                        name: s.name,
                        size: s.size,
                        cost: s.cost,
                        status: s.status,
                        requiredStages: cleanReqStages,
                        createdAt: s.createdAt,
                        pieces: slabPieces
                    };
                });
                // Disambiguate slabs with duplicate names instead of dropping them
                const seenNames = new Map();
                slabs.forEach((s) => {
                    const norm = (s.name || '').trim().toLowerCase();
                    const count = seenNames.get(norm) || 0;
                    seenNames.set(norm, count + 1);
                    if (count > 0) {
                        s.name = `${s.name} (${count + 1})`;
                    }
                });
                fastCache_1.fastCache.set(cacheKey, slabs, 30);
                return res.json(slabs);
            }
            catch (err) {
                console.warn('Mongoose slab query failed, falling back to Prisma:', err);
            }
        }
        const prismaSlabs = await index_1.prisma.slab.findMany({
            where: { projectId: String(projectId) },
            orderBy: { createdAt: 'asc' },
            include: {
                inventory: true,
                pieces: {
                    include: {
                        sourceMaterial: {
                            include: {
                                inventory: true
                            }
                        },
                        logs: {
                            select: {
                                id: true,
                                stage: true,
                                status: true,
                                machineId: true,
                                driverName: true,
                                startPhotoUrl: true,
                                endPhotoUrl: true,
                                remarks: true,
                                createdAt: true
                            }
                        }
                    },
                    orderBy: { pieceNumber: 'asc' }
                }
            }
        });
        const seenPrismaNames = new Map();
        prismaSlabs.forEach((s) => {
            const norm = (s.name || '').trim().toLowerCase();
            const count = seenPrismaNames.get(norm) || 0;
            seenPrismaNames.set(norm, count + 1);
            if (count > 0) {
                s.name = `${s.name} (${count + 1})`;
            }
        });
        const uniquePrismaSlabs = prismaSlabs;
        uniquePrismaSlabs.forEach((s) => {
            const slabIsFeet = /\bfeet\b/i.test((s.size || '').split('|')[0] || '');
            if (Array.isArray(s.pieces)) {
                s.pieces.forEach((p) => {
                    if (slabIsFeet && p.size && /\binch\b/i.test(p.size) && !/\(\s*[\d.]+\s*Sq\.?Ft\s*\)/i.test(p.size)) {
                        const lM = p.size.match(/([\d.]+)\s*L/i);
                        const wM = p.size.match(/([\d.]+)\s*W/i);
                        const lVal = lM && lM[1] ? parseFloat(lM[1]) : 0;
                        const wVal = wM && wM[1] ? parseFloat(wM[1]) : 0;
                        const areaStr = (lVal > 0 && wVal > 0) ? ` (${(lVal * wVal).toFixed(2)} Sq.Ft)` : '';
                        p.size = p.size.replace(/\binch\b/i, 'Feet') + areaStr;
                        index_1.prisma.piece.update({ where: { id: p.id }, data: { size: p.size } }).catch(() => { });
                    }
                    const normStage = (p.stage || '').replace(' Work', '').trim();
                    if (normStage === 'Packing' || normStage === 'Dispatch') {
                        const hasApprovedLog = Array.isArray(p.logs) && p.logs.some((l) => {
                            const lStage = (l.stage || '').replace(' Work', '').trim();
                            return (lStage === normStage || lStage.startsWith(normStage)) && (l.status === 'approved' || l.status === 'completed');
                        });
                        if (!hasApprovedLog) {
                            p.status = 'pending';
                            const hasPolishingLog = Array.isArray(p.logs) && p.logs.some((l) => (l.stage || '').startsWith('Polishing'));
                            p.stage = hasPolishingLog ? 'Polishing' : 'Production';
                            index_1.prisma.piece.update({ where: { id: p.id }, data: { status: 'pending', stage: p.stage } }).catch(() => { });
                        }
                    }
                });
            }
        });
        fastCache_1.fastCache.set(cacheKey, uniquePrismaSlabs, 60);
        res.json(uniquePrismaSlabs);
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
        const existingSlabs = await index_1.prisma.slab.findMany({
            where: { projectId: String(projectId) },
            select: { id: true, name: true }
        });
        const existingNames = new Set(existingSlabs.map(s => (s.name || '').trim().toLowerCase()));
        const createdSlabs = [];
        for (const item of slabs) {
            const slabName = item.name || 'Slab';
            const normName = slabName.trim().toLowerCase();
            if (existingNames.has(normName)) {
                continue; // Skip duplicate slab names
            }
            existingNames.add(normName);
            const slabSize = item.size || null;
            const reqStages = item.requiredStages && Array.isArray(item.requiredStages) && item.requiredStages.length > 0
                ? item.requiredStages
                : ['Production'];
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
        // Sync quotation products & invalidate caches
        await (0, projectSync_1.syncQuotationFromSlabs)(String(projectId)).catch((e) => console.error('Error syncing quotation after bulk-create:', e));
        (0, projectSync_1.invalidateProjectCaches)(String(projectId));
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
        // 4. Sync quotation products & invalidate caches
        await (0, projectSync_1.syncQuotationFromSlabs)(String(projectId)).catch((e) => console.error('Error syncing quotation after replicate-template:', e));
        (0, projectSync_1.invalidateProjectCaches)(String(projectId));
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
        const existingSlab = await index_1.prisma.slab.findFirst({
            where: {
                projectId: String(projectId),
                name: { equals: name, mode: 'insensitive' }
            }
        });
        if (existingSlab) {
            return res.status(200).json(existingSlab);
        }
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
                requiredStages: requiredStages || ['Production'],
                pieces: pieces ? { create: pieces } : undefined
            }
        });
        await (0, projectSync_1.syncQuotationFromSlabs)(String(projectId)).catch((e) => console.error('Error syncing quotation after slab create:', e));
        (0, projectSync_1.invalidateProjectCaches)(String(projectId));
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
                const pUnit = String(piecesArray[i].unit || '').toLowerCase();
                let pieceArea = 0;
                if (l > 0 && w > 0) {
                    if (pUnit === 'feet' || pUnit === 'ft' || pUnit === 'sq_ft' || pUnit === 'sqft') {
                        pieceArea = l * w;
                    }
                    else if (pUnit === 'mm') {
                        pieceArea = (l * w) / 92903.04;
                    }
                    else {
                        pieceArea = (l * w) / 144;
                    }
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
        if (size !== undefined) {
            const existingSlabWithPieces = await index_1.prisma.slab.findUnique({
                where: { id: String(id) },
                include: { pieces: true }
            });
            if (existingSlabWithPieces) {
                const existingPiecesArea = (0, projectSync_1.calculateSlabExistingPiecesArea)(existingSlabWithPieces.pieces);
                const newSlabArea = Math.round((0, projectSync_1.parsePieceAreaSqFt)(size) * 100) / 100;
                if (existingPiecesArea > 0 && newSlabArea > 0 && newSlabArea + 0.01 < existingPiecesArea) {
                    return res.status(400).json({
                        message: `Cannot reduce slab size (${newSlabArea.toFixed(2)} Sq.Ft) below the total area of its existing ${existingSlabWithPieces.pieces.length} inside pieces (${existingPiecesArea.toFixed(2)} Sq.Ft).`
                    });
                }
            }
        }
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
        // If size or name changed and there's 1 piece (full slab), sync piece specifications
        try {
            const pieces = await index_1.prisma.piece.findMany({ where: { slabId: String(id) } });
            if (pieces.length === 1 && String(pieces[0]?.productName || '').includes('(Full Slab)')) {
                const pieceUpdate = {};
                if (updateData.size)
                    pieceUpdate.size = updateData.size;
                if (updateData.name)
                    pieceUpdate.productName = `${updateData.name} 1.1 (Full Slab)`;
                if (Object.keys(pieceUpdate).length > 0) {
                    await index_1.prisma.piece.updateMany({
                        where: { slabId: String(id) },
                        data: pieceUpdate
                    });
                }
            }
        }
        catch (e) {
            console.error('Error syncing piece with updated slab:', e);
        }
        if (updatedSlab?.projectId) {
            await (0, projectSync_1.syncQuotationFromSlabs)(String(updatedSlab.projectId)).catch((e) => console.error('Error syncing quotation after slab update:', e));
        }
        (0, projectSync_1.invalidateProjectCaches)(updatedSlab?.projectId ? String(updatedSlab.projectId) : undefined);
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
        (0, projectSync_1.invalidateProjectCaches)();
        res.json({ message: `Updated stages for ${slabIds.length} slabs`, count: slabIds.length });
    }
    catch (error) {
        console.error('Error bulk updating slab stages:', error);
        res.status(500).json({ message: 'Server error bulk updating slab stages', error: error?.message || error });
    }
});
// Bulk delete multiple slabs and their pieces
router.post('/bulk-delete', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'No slab IDs provided for deletion' });
        }
        const slabIds = ids.map(id => String(id));
        const targetSlabs = await index_1.prisma.slab.findMany({
            where: { id: { in: slabIds } },
            select: { id: true, projectId: true }
        });
        const projectIds = Array.from(new Set(targetSlabs.map(s => s.projectId).filter(Boolean)));
        // Find all pieces under these slabs
        const pieces = await index_1.prisma.piece.findMany({ where: { slabId: { in: slabIds } } });
        const pieceIds = pieces.map(p => p.id);
        const allRemovedIds = [...slabIds, ...pieceIds];
        if (pieceIds.length > 0) {
            await index_1.prisma.pieceLog.deleteMany({
                where: { pieceId: { in: pieceIds } }
            }).catch(e => console.error(e));
        }
        if (allRemovedIds.length > 0) {
            await index_1.prisma.productionLog.deleteMany({
                where: {
                    OR: [
                        { slabId: { in: slabIds } },
                        { productId: { in: allRemovedIds } },
                        { pieceIds: { hasSome: allRemovedIds } }
                    ]
                }
            }).catch(e => console.error(e));
            await index_1.prisma.machineLog.deleteMany({
                where: { productId: { in: allRemovedIds } }
            }).catch(e => console.error(e));
        }
        await index_1.prisma.piece.deleteMany({
            where: { slabId: { in: slabIds } }
        }).catch(e => console.error(e));
        await index_1.prisma.slab.deleteMany({
            where: { id: { in: slabIds } }
        }).catch(e => console.error(e));
        for (const projId of projectIds) {
            const remainingSlabs = await index_1.prisma.slab.count({ where: { projectId: String(projId) } });
            if (remainingSlabs === 0) {
                await Promise.all([
                    index_1.prisma.productionLog.deleteMany({ where: { projectId: String(projId) } }).catch(() => { }),
                    index_1.prisma.machineLog.deleteMany({ where: { projectId: String(projId) } }).catch(() => { }),
                    index_1.prisma.crate.deleteMany({ where: { projectId: String(projId) } }).catch(() => { }),
                    index_1.prisma.dispatch.deleteMany({ where: { projectId: String(projId) } }).catch(() => { })
                ]);
            }
            await (0, projectSync_1.syncQuotationFromSlabs)(String(projId)).catch((e) => console.error('Error syncing quotation after bulk-delete:', e));
            (0, projectSync_1.invalidateProjectCaches)(String(projId));
        }
        (0, projectSync_1.invalidateProjectCaches)();
        res.json({ message: `Successfully deleted ${slabIds.length} slabs`, count: slabIds.length });
    }
    catch (error) {
        console.error('Error in bulk-delete slabs:', error);
        res.status(500).json({ message: 'Server error bulk deleting slabs', error: error?.message || error });
    }
});
// Delete a slab
router.delete('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const existingSlab = await index_1.prisma.slab.findUnique({
            where: { id: String(id) },
            select: { id: true, projectId: true }
        });
        // Find all pieces
        const pieces = await index_1.prisma.piece.findMany({ where: { slabId: String(id) } });
        const pieceIds = pieces.map(p => p.id);
        const allRemovedIds = [String(id), ...pieceIds];
        if (pieceIds.length > 0) {
            await index_1.prisma.pieceLog.deleteMany({
                where: { pieceId: { in: pieceIds } }
            }).catch(e => console.error(e));
        }
        await index_1.prisma.productionLog.deleteMany({
            where: {
                OR: [
                    { slabId: String(id) },
                    { productId: { in: allRemovedIds } },
                    { pieceIds: { hasSome: allRemovedIds } }
                ]
            }
        }).catch(e => console.error(e));
        await index_1.prisma.machineLog.deleteMany({
            where: { productId: { in: allRemovedIds } }
        }).catch(e => console.error(e));
        await index_1.prisma.piece.deleteMany({
            where: { slabId: String(id) }
        }).catch(e => console.error(e));
        await index_1.prisma.slab.deleteMany({
            where: { id: String(id) }
        }).catch(e => console.error(e));
        if (existingSlab?.projectId) {
            const projIdStr = String(existingSlab.projectId);
            const remainingSlabs = await index_1.prisma.slab.count({ where: { projectId: projIdStr } });
            if (remainingSlabs === 0) {
                await Promise.all([
                    index_1.prisma.productionLog.deleteMany({ where: { projectId: projIdStr } }).catch(() => { }),
                    index_1.prisma.machineLog.deleteMany({ where: { projectId: projIdStr } }).catch(() => { }),
                    index_1.prisma.crate.deleteMany({ where: { projectId: projIdStr } }).catch(() => { }),
                    index_1.prisma.dispatch.deleteMany({ where: { projectId: projIdStr } }).catch(() => { })
                ]);
            }
            await (0, projectSync_1.syncQuotationFromSlabs)(projIdStr).catch((e) => console.error('Error syncing quotation after slab delete:', e));
            (0, projectSync_1.invalidateProjectCaches)(projIdStr);
        }
        else {
            (0, projectSync_1.invalidateProjectCaches)();
        }
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
        const { vendorName, vendorId, size, status, productName, stage, sourceMaterialId } = req.body;
        if (size !== undefined) {
            const targetPiece = await index_1.prisma.piece.findUnique({
                where: { id: String(req.params.id) },
                include: { slab: { include: { pieces: true } } }
            });
            if (targetPiece?.slab) {
                const slabArea = Math.round((0, projectSync_1.parsePieceAreaSqFt)(targetPiece.slab.size) * 100) / 100;
                const newPieceArea = Math.round((0, projectSync_1.parsePieceAreaSqFt)(size) * 100) / 100;
                const otherPiecesArea = Math.round((targetPiece.slab.pieces || [])
                    .filter((p) => p.id !== targetPiece.id)
                    .reduce((acc, p) => acc + (0, projectSync_1.parsePieceAreaSqFt)(p.size), 0) * 100) / 100;
                const totalArea = Math.round((otherPiecesArea + newPieceArea) * 100) / 100;
                if (slabArea > 0 && totalArea > slabArea + 0.01) {
                    return res.status(400).json({
                        message: `Total piece area (${totalArea.toFixed(2)} Sq.Ft) exceeds allowed slab limit (${slabArea.toFixed(2)} Sq.Ft)!`
                    });
                }
            }
        }
        const pieceData = {};
        if (vendorName !== undefined)
            pieceData.vendorName = vendorName;
        if (sourceMaterialId !== undefined)
            pieceData.sourceMaterialId = sourceMaterialId || null;
        if (vendorId !== undefined) {
            pieceData.vendorId = (vendorId && typeof vendorId === 'string' && vendorId.length === 24) ? vendorId : null;
        }
        if (size !== undefined)
            pieceData.size = size;
        if (productName !== undefined)
            pieceData.productName = productName;
        if (stage !== undefined)
            pieceData.stage = stage;
        if (status !== undefined) {
            const targetStatus = (status === 'pending' || status === 'not_started') ? 'pending' : 'completed';
            pieceData.status = targetStatus;
            if (targetStatus === 'pending') {
                // Clear completed logs so it drops to 0% / Not Started immediately!
                await index_1.prisma.pieceLog.deleteMany({
                    where: { pieceId: String(req.params.id) }
                }).catch(() => { });
                await index_1.prisma.productionLog.deleteMany({
                    where: {
                        OR: [
                            { pieceIds: { has: String(req.params.id) } },
                            { productId: String(req.params.id) }
                        ]
                    }
                }).catch(() => { });
            }
        }
        const updatedPiece = await index_1.prisma.piece.update({
            where: { id: String(req.params.id) },
            data: pieceData
        });
        // Sync slab status
        if (updatedPiece.slabId) {
            const allPieces = await index_1.prisma.piece.findMany({ where: { slabId: updatedPiece.slabId } });
            const completedCount = allPieces.filter(p => p.status === 'completed').length;
            let newSlabStatus = 'not_started';
            if (completedCount === allPieces.length && allPieces.length > 0) {
                newSlabStatus = 'completed';
            }
            else if (completedCount > 0) {
                newSlabStatus = 'in_production';
            }
            await index_1.prisma.slab.update({
                where: { id: updatedPiece.slabId },
                data: { status: newSlabStatus }
            }).catch(() => { });
        }
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
// Unlink raw block from piece
router.post('/piece/:id/unlink-raw-block', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const updatedPiece = await index_1.prisma.piece.update({
            where: { id: String(id) },
            data: {
                sourceMaterialId: null,
                vendorName: null
            }
        });
        fastCache_1.fastCache.clearAll();
        res.json({ success: true, piece: updatedPiece });
    }
    catch (error) {
        console.error('Error unlinking raw block:', error);
        res.status(500).json({ message: 'Server error unlinking raw block' });
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
        await index_1.prisma.productionLog.deleteMany({
            where: {
                OR: [
                    { productId: String(id) },
                    { pieceIds: { has: String(id) } }
                ]
            }
        }).catch(e => console.error(e));
        await index_1.prisma.machineLog.deleteMany({
            where: { productId: String(id) }
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