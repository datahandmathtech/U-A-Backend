"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMergedProductsForProject = exports.syncQuotationFromSlabs = exports.syncSlabsAndQuotationFromProducts = exports.normalizeQuotationProduct = exports.parseSlabToProduct = exports.calculateSlabExistingPiecesArea = exports.parsePieceAreaSqFt = exports.formatProductToSlabSize = exports.invalidateProjectCaches = void 0;
const index_1 = require("../index");
const fastCache_1 = require("./fastCache");
const invalidateProjectCaches = (projectId) => {
    fastCache_1.fastCache.invalidate('all_projects');
    fastCache_1.fastCache.invalidate('dashboard_summary');
    fastCache_1.fastCache.invalidate('slabs_project_');
    fastCache_1.fastCache.invalidate('project_hierarchy_v2');
    fastCache_1.fastCache.invalidate('project_hierarchy_v3');
    fastCache_1.fastCache.invalidate('all_names_v2');
    if (projectId) {
        fastCache_1.fastCache.invalidate(`slabs_project_v3_${projectId}`);
    }
};
exports.invalidateProjectCaches = invalidateProjectCaches;
const formatProductToSlabSize = (prod) => {
    const l = parseFloat(prod.length) || 0;
    const w = parseFloat(prod.width) || 0;
    const t = parseFloat(prod.breadth ?? prod.thickness) || 0;
    const u = (prod.unit || 'pieces').toLowerCase().trim();
    const isPieces = u === 'pieces' || u === 'piece' || u === 'pcs' || !u;
    let isFt = false;
    let isMM = false;
    if (isPieces) {
        const dimU = (prod.dimensionUnit || 'inch').toLowerCase().trim();
        isFt = dimU === 'sq_ft' || dimU === 'sqft' || dimU === 'feet' || dimU === 'ft';
        isMM = dimU === 'mm';
    }
    else {
        isFt = u === 'sq_ft' || u === 'sqft' || u === 'sq. ft' || u === 'sq ft' || u.includes('feet') || u.includes('sq') || u.includes('ft') || u.includes('rft');
        isMM = u === 'mm' || u.includes('millimeter');
    }
    const unitLabel = isFt ? 'Feet' : (isMM ? 'MM' : 'Inch');
    if (l <= 0 && w <= 0 && prod.size) {
        return String(prod.size);
    }
    const calcSqFt = (isFt ? l * w : isMM ? (l * w) / 92903.04 : (l * w) / 144).toFixed(2);
    return `${l}L x ${w}W ${unitLabel}${t ? ` | ${t}MM` : ''} (${calcSqFt} Sq.Ft)`;
};
exports.formatProductToSlabSize = formatProductToSlabSize;
const parsePieceAreaSqFt = (sizeStr) => {
    if (!sizeStr)
        return 0;
    const raw = String(sizeStr);
    const dimsPart = (raw.split('|')[0] || '').toLowerCase();
    const lMatch = raw.match(/(\d+(?:\.\d+)?)\s*L/i) || dimsPart.match(/(\d+(?:\.\d+)?)/);
    const wMatch = raw.match(/(\d+(?:\.\d+)?)\s*W/i) || dimsPart.match(/[xX*×]\s*(\d+(?:\.\d+)?)/);
    const l = (lMatch && lMatch[1]) ? parseFloat(lMatch[1]) : 0;
    const w = (wMatch && wMatch[1]) ? parseFloat(wMatch[1]) : 0;
    const explicitMatch = raw.match(/([\d.]+)\s*Sq\.?Ft/i);
    if (explicitMatch && explicitMatch[1]) {
        return parseFloat(explicitMatch[1]) || 0;
    }
    if (l > 0 && w > 0) {
        if (dimsPart.includes('feet') || dimsPart.includes('ft') || dimsPart.includes('sq_ft') || dimsPart.includes('sqft')) {
            return l * w;
        }
        if (dimsPart.includes('inch') || dimsPart.includes('"')) {
            return (l * w) / 144;
        }
        if (dimsPart.includes('mm')) {
            return (l * w) / 92903.04;
        }
        return (l * w) / 144;
    }
    return 0;
};
exports.parsePieceAreaSqFt = parsePieceAreaSqFt;
const calculateSlabExistingPiecesArea = (pieces) => {
    if (!Array.isArray(pieces) || pieces.length === 0)
        return 0;
    if (pieces.length === 1 && String(pieces[0]?.productName || '').includes('(Full Slab)')) {
        return 0;
    }
    const sum = pieces.reduce((acc, p) => acc + (0, exports.parsePieceAreaSqFt)(p.size), 0);
    return Math.round(sum * 100) / 100;
};
exports.calculateSlabExistingPiecesArea = calculateSlabExistingPiecesArea;
const parseSlabToProduct = (slab, existingProduct) => {
    let l = Number(existingProduct?.length) || 0;
    let w = Number(existingProduct?.width) || 0;
    let breadth = Number(existingProduct?.breadth ?? existingProduct?.thickness) || 0;
    let dimUnit = existingProduct?.dimensionUnit || 'inch';
    if (slab.size) {
        const rawSize = String(slab.size);
        const dimsPart = (rawSize.split('|')[0] || '').toLowerCase();
        const lMatch = rawSize.match(/(\d+(?:\.\d+)?)\s*L/i) || dimsPart.match(/(\d+(?:\.\d+)?)/);
        const wMatch = rawSize.match(/(\d+(?:\.\d+)?)\s*W/i) || dimsPart.match(/[xX*×]\s*(\d+(?:\.\d+)?)/);
        const tMatch = rawSize.match(/\|\s*(\d+(?:\.\d+)?)\s*MM/i) || rawSize.match(/(\d+(?:\.\d+)?)\s*MM/i);
        if (lMatch && lMatch[1])
            l = parseFloat(lMatch[1]) || 0;
        if (wMatch && wMatch[1])
            w = parseFloat(wMatch[1]) || 0;
        if (tMatch && tMatch[1])
            breadth = parseFloat(tMatch[1]) || 0;
        const existingDimUnit = (existingProduct?.dimensionUnit || existingProduct?.unit || '').toLowerCase();
        if (dimsPart.includes('feet') || dimsPart.includes('ft') || dimsPart.includes('sq_ft') || dimsPart.includes('sqft')) {
            dimUnit = 'sq_ft';
        }
        else if (dimsPart.includes('inch') || dimsPart.includes('"')) {
            dimUnit = 'inch';
        }
        else if (dimsPart.includes('mm')) {
            dimUnit = 'mm';
        }
        else if (existingDimUnit.includes('feet') || existingDimUnit.includes('ft') || existingDimUnit.includes('sq')) {
            dimUnit = 'sq_ft';
        }
        else if (existingDimUnit.includes('inch') || existingDimUnit.includes('"')) {
            dimUnit = 'inch';
        }
        else if (existingDimUnit === 'mm' || existingDimUnit.includes('milli')) {
            dimUnit = 'mm';
        }
    }
    const isFt = dimUnit === 'sq_ft' || dimUnit === 'feet' || dimUnit === 'ft';
    const isMM = dimUnit === 'mm';
    const sqft = isFt ? l * w : (isMM ? (l * w) / 92903.04 : (l * w) / 144);
    const defaultUnitFromSlab = dimUnit === 'sq_ft' ? 'Sq. Ft' : dimUnit;
    const existingU = (existingProduct?.unit || '').trim();
    const unit = (existingU && existingU.toLowerCase() !== 'pieces' && existingU.toLowerCase() !== 'piece' && existingU.toLowerCase() !== 'pcs')
        ? existingU
        : defaultUnitFromSlab;
    const qty = 1;
    const rate = Number(existingProduct?.rate) || 0;
    const unitSafe = (unit || 'pieces').toLowerCase().trim();
    let amount = Number(existingProduct?.amount) || 0;
    if (rate > 0) {
        if (unitSafe.includes('inch')) {
            amount = Math.round(((l * w) / 144) * qty * rate);
        }
        else if (unitSafe === 'mm') {
            amount = Math.round(((l * w) / 92903.04) * qty * rate);
        }
        else if (unitSafe === 'pieces' || unitSafe === 'piece' || unitSafe === 'pcs') {
            amount = Math.round(qty * rate);
        }
        else {
            amount = Math.round(l * w * qty * rate);
        }
    }
    const slabIdStr = (slab.id || slab._id)?.toString();
    const cleanName = (slab.name || existingProduct?.category || existingProduct?.productName || existingProduct?.name || 'Product').trim();
    return {
        id: slabIdStr || existingProduct?.id || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        slabId: slabIdStr,
        category: cleanName,
        productName: cleanName,
        name: cleanName,
        unit,
        dimensionUnit: dimUnit,
        length: l,
        width: w,
        breadth,
        thickness: breadth,
        qty,
        rate,
        amount,
        sqft: Number(sqft.toFixed(2)),
        ...(existingProduct?.photo ? { photo: existingProduct.photo } : {})
    };
};
exports.parseSlabToProduct = parseSlabToProduct;
const normalizeQuotationProduct = (prod, index, existingProd) => {
    const rawName = (prod.category || prod.productName || prod.name || existingProd?.category || existingProd?.productName || '').trim();
    const u = (prod.unit || existingProd?.unit || 'pieces').toLowerCase().trim();
    const isPieces = u === 'pieces' || u === 'piece' || u === 'pcs' || !u;
    let isFt = false;
    let isMM = false;
    if (isPieces) {
        const dimU = (prod.dimensionUnit || existingProd?.dimensionUnit || 'inch').toLowerCase().trim();
        isFt = dimU === 'sq_ft' || dimU === 'sqft' || dimU === 'feet' || dimU === 'ft';
        isMM = dimU === 'mm';
    }
    else {
        isFt = u === 'sq_ft' || u === 'sqft' || u === 'sq. ft' || u === 'sq ft' || u.includes('feet') || u.includes('sq') || u.includes('ft') || u.includes('rft');
        isMM = u === 'mm' || u.includes('millimeter');
    }
    const dimUnit = isFt ? 'sq_ft' : (isMM ? 'mm' : 'inch');
    const l = parseFloat(prod.length ?? existingProd?.length) || 0;
    const w = parseFloat(prod.width ?? existingProd?.width) || 0;
    const breadth = parseFloat(prod.breadth ?? prod.thickness ?? existingProd?.breadth ?? existingProd?.thickness) || 0;
    const qty = Math.max(1, Number(prod.qty ?? prod.quantity ?? existingProd?.qty) || 1);
    const rate = prod.rate !== undefined ? (Number(prod.rate) || 0) : (Number(existingProd?.rate) || 0);
    const sqft = isFt ? l * w : (isMM ? (l * w) / 92903.04 : (l * w) / 144);
    let amount = prod.amount !== undefined ? (Number(prod.amount) || 0) : (Number(existingProd?.amount) || 0);
    if (rate > 0) {
        if (u.includes('inch')) {
            amount = Math.round(((l * w) / 144) * qty * rate);
        }
        else if (u === 'mm') {
            amount = Math.round(((l * w) / 92903.04) * qty * rate);
        }
        else if (isPieces) {
            amount = Math.round(qty * rate);
        }
        else {
            amount = Math.round(l * w * qty * rate);
        }
    }
    const photo = prod.photo !== undefined ? prod.photo : existingProd?.photo;
    return {
        id: prod.id || existingProd?.id || `prod_${Date.now()}_${index}`,
        ...(prod.slabId || existingProd?.slabId ? { slabId: prod.slabId || existingProd?.slabId } : {}),
        category: rawName,
        productName: rawName,
        name: rawName,
        unit: prod.unit || existingProd?.unit || 'pieces',
        dimensionUnit: dimUnit,
        length: l,
        width: w,
        breadth,
        thickness: breadth,
        qty,
        rate,
        amount,
        sqft: Number(sqft.toFixed(2)),
        ...(photo ? { photo } : {})
    };
};
exports.normalizeQuotationProduct = normalizeQuotationProduct;
/**
 * Syncs Slab records from an incoming products list (from Edit Work Order Details or Costing & Quotation)
 * and ensures Quotation.products and Slab collection are 100% in sync.
 */
const syncSlabsAndQuotationFromProducts = async (projectId, incomingProducts, options = {}) => {
    const { removeUnmatchedSlabs = true, updateQuotationRecord = true } = options;
    const existingQuotes = await index_1.prisma.quotation.findMany({
        where: { projectId: String(projectId) },
        orderBy: { createdAt: 'desc' }
    });
    const firstQuote = existingQuotes[0];
    const existingQuoteProducts = Array.isArray(firstQuote?.products) ? firstQuote.products : [];
    const currentSlabs = await index_1.prisma.slab.findMany({
        where: { projectId: String(projectId) },
        include: { pieces: true },
        orderBy: { createdAt: 'asc' }
    });
    const validIncoming = (incomingProducts || []).filter((p) => {
        const nm = (p.category || p.productName || p.name || '').trim();
        return nm.length > 0;
    });
    const normalizedProducts = [];
    const matchedSlabIds = new Set();
    for (let i = 0; i < validIncoming.length; i++) {
        const rawProd = validIncoming[i];
        const rawName = (rawProd.category || rawProd.productName || rawProd.name || '').trim();
        // Find existing quotation product to preserve rate/photo if not supplied
        const existingProd = existingQuoteProducts.find((ep) => (rawProd.id && (ep.id === rawProd.id || ep.slabId === rawProd.id)) ||
            (ep.category || ep.productName || ep.name || '').trim().toLowerCase() === rawName.toLowerCase());
        const normProd = (0, exports.normalizeQuotationProduct)(rawProd, i, existingProd);
        const sizeFormatted = (0, exports.formatProductToSlabSize)(normProd);
        const qty = Math.max(1, Number(normProd.qty) || 1);
        if (qty === 1) {
            let matched = currentSlabs.find(s => !matchedSlabIds.has(s.id) && (s.id === normProd.id || s.id === normProd.slabId));
            if (!matched) {
                matched = currentSlabs.find(s => !matchedSlabIds.has(s.id) && s.name.trim().toLowerCase() === rawName.toLowerCase());
            }
            if (matched) {
                const existingPiecesArea = (0, exports.calculateSlabExistingPiecesArea)(matched.pieces);
                if (existingPiecesArea > 0 && normProd.sqft > 0 && normProd.sqft + 0.01 < existingPiecesArea) {
                    throw new Error(`Cannot reduce size of "${rawName}" to ${normProd.sqft.toFixed(2)} Sq.Ft because its inside pieces already total ${existingPiecesArea.toFixed(2)} Sq.Ft.`);
                }
                matchedSlabIds.add(matched.id);
                await index_1.prisma.slab.update({
                    where: { id: matched.id },
                    data: { name: rawName, size: sizeFormatted }
                });
                if (matched.pieces.length === 1 && matched.pieces[0]?.productName?.includes('(Full Slab)')) {
                    await index_1.prisma.piece.updateMany({
                        where: { slabId: matched.id },
                        data: { size: sizeFormatted, productName: `${rawName} 1.1 (Full Slab)` }
                    });
                }
                normProd.id = matched.id;
                normProd.slabId = matched.id;
            }
            else {
                const newSlab = await index_1.prisma.slab.create({
                    data: {
                        projectId: String(projectId),
                        name: rawName,
                        size: sizeFormatted,
                        cost: 0,
                        requiredStages: ['Production']
                    }
                });
                matchedSlabIds.add(newSlab.id);
                normProd.id = newSlab.id;
                normProd.slabId = newSlab.id;
            }
        }
        else {
            // qty > 1: ensure qty slabs exist
            for (let qIdx = 1; qIdx <= qty; qIdx++) {
                const pieceSlabName = `${rawName} ${qIdx}`;
                let matched = currentSlabs.find(s => !matchedSlabIds.has(s.id) && s.name.trim().toLowerCase() === pieceSlabName.toLowerCase());
                if (!matched && qIdx === 1) {
                    matched = currentSlabs.find(s => !matchedSlabIds.has(s.id) && (s.id === normProd.id || s.name.trim().toLowerCase() === rawName.toLowerCase()));
                }
                if (matched) {
                    const singleSlabSqFt = normProd.sqft; // normProd.sqft is already the single piece area
                    const existingPiecesArea = (0, exports.calculateSlabExistingPiecesArea)(matched.pieces);
                    if (existingPiecesArea > 0 && singleSlabSqFt > 0 && singleSlabSqFt + 0.01 < existingPiecesArea) {
                        throw new Error(`Cannot reduce size of "${pieceSlabName}" to ${singleSlabSqFt.toFixed(2)} Sq.Ft because its inside pieces already total ${existingPiecesArea.toFixed(2)} Sq.Ft.`);
                    }
                    matchedSlabIds.add(matched.id);
                    await index_1.prisma.slab.update({
                        where: { id: matched.id },
                        data: { name: pieceSlabName, size: sizeFormatted }
                    });
                }
                else {
                    const newSlab = await index_1.prisma.slab.create({
                        data: {
                            projectId: String(projectId),
                            name: pieceSlabName,
                            size: sizeFormatted,
                            cost: 0,
                            requiredStages: ['Production']
                        }
                    });
                    matchedSlabIds.add(newSlab.id);
                }
            }
        }
        normalizedProducts.push(normProd);
    }
    // Delete unmatched slabs if removeUnmatchedSlabs is enabled
    if (removeUnmatchedSlabs) {
        const slabsToRemove = currentSlabs.filter(s => !matchedSlabIds.has(s.id));
        if (slabsToRemove.length > 0) {
            const removeSlabIds = slabsToRemove.map(s => s.id);
            const pieces = await index_1.prisma.piece.findMany({ where: { slabId: { in: removeSlabIds } }, select: { id: true } });
            const pieceIds = pieces.map(p => p.id);
            const allRemovedIds = [...removeSlabIds, ...pieceIds];
            if (pieceIds.length > 0) {
                await index_1.prisma.pieceLog.deleteMany({ where: { pieceId: { in: pieceIds } } }).catch(() => { });
            }
            if (allRemovedIds.length > 0) {
                await index_1.prisma.productionLog.deleteMany({
                    where: {
                        OR: [
                            { slabId: { in: removeSlabIds } },
                            { productId: { in: allRemovedIds } },
                            { pieceIds: { hasSome: allRemovedIds } }
                        ]
                    }
                }).catch(() => { });
                await index_1.prisma.machineLog.deleteMany({
                    where: { productId: { in: allRemovedIds } }
                }).catch(() => { });
            }
            await index_1.prisma.piece.deleteMany({ where: { slabId: { in: removeSlabIds } } }).catch(() => { });
            await index_1.prisma.slab.deleteMany({ where: { id: { in: removeSlabIds } } }).catch(() => { });
        }
        if (validIncoming.length === 0) {
            await Promise.all([
                index_1.prisma.productionLog.deleteMany({ where: { projectId: String(projectId) } }).catch(() => { }),
                index_1.prisma.machineLog.deleteMany({ where: { projectId: String(projectId) } }).catch(() => { }),
                index_1.prisma.crate.deleteMany({ where: { projectId: String(projectId) } }).catch(() => { }),
                index_1.prisma.dispatch.deleteMany({ where: { projectId: String(projectId) } }).catch(() => { })
            ]);
        }
    }
    if (updateQuotationRecord) {
        const productsTotal = normalizedProducts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        if (firstQuote) {
            let additionalCostsList = [];
            const additionalCosts = firstQuote.additionalCosts;
            if (Array.isArray(additionalCosts)) {
                additionalCostsList = additionalCosts;
            }
            else if (additionalCosts && typeof additionalCosts === 'object') {
                Object.values(additionalCosts).forEach((costs) => {
                    if (Array.isArray(costs))
                        additionalCostsList = additionalCostsList.concat(costs);
                });
            }
            const additionalTotal = additionalCostsList.reduce((sum, item) => sum + Number(item.amount || 0), 0);
            const totalCost = productsTotal + additionalTotal;
            const globalCosts = (firstQuote.globalCosts || {});
            let globalCostsTotal = 0;
            let gstPercent = Number(firstQuote.marginPercentage || 0);
            if (globalCosts) {
                if (globalCosts.packageCostEnabled)
                    globalCostsTotal += Number(globalCosts.packageCost || 0);
                if (globalCosts.transportCostEnabled)
                    globalCostsTotal += Number(globalCosts.transportCost || 0);
                if (globalCosts.gstPercent !== undefined)
                    gstPercent = Number(globalCosts.gstPercent || 0);
            }
            const subTotal = totalCost + globalCostsTotal;
            const finalAmountWithGst = Math.round(subTotal + ((subTotal * gstPercent) / 100));
            await index_1.prisma.quotation.update({
                where: { id: firstQuote.id },
                data: {
                    products: normalizedProducts,
                    totalCost,
                    finalAmount: finalAmountWithGst
                }
            });
        }
        else if (normalizedProducts.length > 0) {
            await index_1.prisma.quotation.create({
                data: {
                    projectId: String(projectId),
                    products: normalizedProducts,
                    totalCost: productsTotal,
                    finalAmount: productsTotal,
                    status: 'approved'
                }
            });
        }
    }
    // Update totalPieces on Project
    const finalSlabCount = matchedSlabIds.size;
    await index_1.prisma.project.update({
        where: { id: String(projectId) },
        data: { totalPieces: finalSlabCount }
    }).catch(() => { });
    (0, exports.invalidateProjectCaches)(projectId);
    return normalizedProducts;
};
exports.syncSlabsAndQuotationFromProducts = syncSlabsAndQuotationFromProducts;
/**
 * Syncs Quotation.products from current Slab records in the database
 * (called when slabs are added/edited/deleted in Slabs & Production Planning or Master Maker).
 */
const syncQuotationFromSlabs = async (projectId) => {
    if (!projectId)
        return [];
    const currentSlabs = await index_1.prisma.slab.findMany({
        where: { projectId: String(projectId) },
        orderBy: { createdAt: 'asc' }
    });
    const existingQuotes = await index_1.prisma.quotation.findMany({
        where: { projectId: String(projectId) },
        orderBy: { createdAt: 'desc' }
    });
    const firstQuote = existingQuotes[0];
    const existingProducts = Array.isArray(firstQuote?.products) ? firstQuote.products : [];
    const syncedProducts = currentSlabs.map((slab) => {
        let matchedProd = existingProducts.find((p) => p.id === slab.id || p.slabId === slab.id ||
            (p.category || p.productName || p.name || '').trim().toLowerCase() === slab.name.trim().toLowerCase());
        if (!matchedProd) {
            // Fallback: match by base name prefix (e.g. "HYD Tile" for "HYD Tile 5") to inherit unit/rate if any
            const baseSlabName = slab.name.replace(/\s+\d+$/, '').trim().toLowerCase();
            matchedProd = existingProducts.find((p) => (p.category || p.productName || p.name || '').trim().toLowerCase() === baseSlabName);
            if (matchedProd) {
                matchedProd = { ...matchedProd, id: slab.id, slabId: slab.id };
            }
        }
        return (0, exports.parseSlabToProduct)(slab, matchedProd);
    });
    const productsTotal = syncedProducts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    if (firstQuote) {
        let additionalCostsList = [];
        const additionalCosts = firstQuote.additionalCosts;
        if (Array.isArray(additionalCosts)) {
            additionalCostsList = additionalCosts;
        }
        else if (additionalCosts && typeof additionalCosts === 'object') {
            Object.values(additionalCosts).forEach((costs) => {
                if (Array.isArray(costs))
                    additionalCostsList = additionalCostsList.concat(costs);
            });
        }
        const additionalTotal = additionalCostsList.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const totalCost = productsTotal + additionalTotal;
        const globalCosts = (firstQuote.globalCosts || {});
        let globalCostsTotal = 0;
        let gstPercent = Number(firstQuote.marginPercentage || 0);
        if (globalCosts) {
            if (globalCosts.packageCostEnabled)
                globalCostsTotal += Number(globalCosts.packageCost || 0);
            if (globalCosts.transportCostEnabled)
                globalCostsTotal += Number(globalCosts.transportCost || 0);
            if (globalCosts.gstPercent !== undefined)
                gstPercent = Number(globalCosts.gstPercent || 0);
        }
        const subTotal = totalCost + globalCostsTotal;
        const finalAmountWithGst = Math.round(subTotal + ((subTotal * gstPercent) / 100));
        await index_1.prisma.quotation.update({
            where: { id: firstQuote.id },
            data: {
                products: syncedProducts,
                totalCost,
                finalAmount: finalAmountWithGst
            }
        });
    }
    else if (syncedProducts.length > 0) {
        await index_1.prisma.quotation.create({
            data: {
                projectId: String(projectId),
                products: syncedProducts,
                totalCost: productsTotal,
                finalAmount: productsTotal,
                status: 'approved'
            }
        });
    }
    await index_1.prisma.project.update({
        where: { id: String(projectId) },
        data: { totalPieces: currentSlabs.length }
    }).catch(() => { });
    (0, exports.invalidateProjectCaches)(projectId);
    return syncedProducts;
};
exports.syncQuotationFromSlabs = syncQuotationFromSlabs;
/**
 * Merges slabs into quotation products in-memory (and triggers background DB sync if out of sync)
 * so GET /api/projects and GET /api/projects/:id always return complete products.
 */
const ensureMergedProductsForProject = (projectId, slabs, quotations) => {
    const firstQuote = quotations && quotations.length > 0 ? quotations[0] : null;
    const quoteProducts = Array.isArray(firstQuote?.products) ? [...firstQuote.products] : [];
    if (!slabs || slabs.length === 0) {
        return { products: quoteProducts, quotations, needsDbSync: false };
    }
    let needsDbSync = false;
    const mergedProducts = [...quoteProducts];
    for (const slab of slabs) {
        const slabIdStr = (slab.id || slab._id)?.toString();
        const slabNameNorm = (slab.name || '').trim().toLowerCase();
        if (!slabNameNorm)
            continue;
        const existingIdx = mergedProducts.findIndex((p) => {
            const pNameNorm = (p.category || p.productName || p.name || '').trim().toLowerCase();
            const qty = Math.max(1, Number(p.qty) || 1);
            if (p.id === slabIdStr || p.slabId === slabIdStr || pNameNorm === slabNameNorm)
                return true;
            if (qty > 1 && slabNameNorm.startsWith(pNameNorm + ' '))
                return true;
            return false;
        });
        if (existingIdx === -1) {
            mergedProducts.push((0, exports.parseSlabToProduct)(slab));
            needsDbSync = true;
        }
        else {
            // Check if product needs dimension/name sync from slab
            const ep = mergedProducts[existingIdx];
            const qty = Math.max(1, Number(ep.qty) || 1);
            const synced = (0, exports.parseSlabToProduct)(slab, ep);
            if (qty === 1) {
                if (synced.category !== ep.category ||
                    synced.length !== Number(ep.length) ||
                    synced.width !== Number(ep.width) ||
                    synced.breadth !== Number(ep.breadth ?? ep.thickness)) {
                    mergedProducts[existingIdx] = synced;
                    needsDbSync = true;
                }
            }
            else if (synced.length !== Number(ep.length) ||
                synced.width !== Number(ep.width) ||
                synced.breadth !== Number(ep.breadth ?? ep.thickness)) {
                mergedProducts[existingIdx] = {
                    ...ep,
                    length: synced.length,
                    width: synced.width,
                    breadth: synced.breadth,
                    thickness: synced.thickness,
                    dimensionUnit: synced.dimensionUnit,
                    sqft: Number((synced.sqft * qty).toFixed(2))
                };
                needsDbSync = true;
            }
        }
    }
    let updatedQuotations = quotations ? [...quotations] : [];
    if (updatedQuotations.length > 0) {
        updatedQuotations[0] = {
            ...updatedQuotations[0],
            products: mergedProducts
        };
    }
    else if (mergedProducts.length > 0) {
        updatedQuotations = [{
                id: `temp_quote_${projectId}`,
                projectId,
                products: mergedProducts,
                additionalCosts: {},
                terms: [],
                globalCosts: {},
                status: 'approved'
            }];
        needsDbSync = true;
    }
    return { products: mergedProducts, quotations: updatedQuotations, needsDbSync };
};
exports.ensureMergedProductsForProject = ensureMergedProductsForProject;
//# sourceMappingURL=projectSync.js.map