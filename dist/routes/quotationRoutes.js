"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const index_1 = require("../index");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Get quotations by project
router.get('/project/:projectId', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId } = req.params;
        const quotations = await index_1.prisma.quotation.findMany({
            where: { projectId: String(projectId) },
            orderBy: { createdAt: 'desc' }
        });
        res.json(quotations);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error fetching quotations' });
    }
});
// Create Quotation
router.post('/', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { projectId, marginPercentage, products, additionalCosts } = req.body;
        // Calculate products total if available
        const productsTotal = products && Array.isArray(products)
            ? products.reduce((sum, p) => sum + Number(p.amount || 0), 0)
            : 0;
        // Calculate additional costs total and map to standard columns for backward compatibility
        let additionalCostsList = [];
        if (Array.isArray(additionalCosts)) {
            additionalCostsList = additionalCosts;
        }
        else if (additionalCosts && typeof additionalCosts === 'object') {
            Object.values(additionalCosts).forEach((costs) => {
                if (Array.isArray(costs)) {
                    additionalCostsList = additionalCostsList.concat(costs);
                }
            });
        }
        const additionalTotal = additionalCostsList.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        let matCost = 0, cCost = 0, hcCost = 0, inCost = 0, polCost = 0, packCost = 0, transCost = 0, instCost = 0;
        additionalCostsList.forEach((item) => {
            const name = (item.name || '').toLowerCase().trim();
            const amount = Number(item.amount || 0);
            if (name === 'material cost')
                matCost = amount;
            else if (name === 'cnc cost')
                cCost = amount;
            else if (name === 'hand carving cost')
                hcCost = amount;
            else if (name === 'inlay cost')
                inCost = amount;
            else if (name === 'polishing cost')
                polCost = amount;
            else if (name === 'packing cost')
                packCost = amount;
            else if (name === 'transport cost')
                transCost = amount;
            else if (name === 'installation cost')
                instCost = amount;
        });
        const totalCost = productsTotal + additionalTotal;
        const finalAmount = totalCost + (totalCost * (Number(marginPercentage || 0) / 100));
        const newQuotation = await index_1.prisma.quotation.create({
            data: {
                projectId,
                materialCost: matCost,
                cncCost: cCost,
                handCarvingCost: hcCost,
                inlayCost: inCost,
                polishingCost: polCost,
                packingCost: packCost,
                transportCost: transCost,
                installationCost: instCost,
                marginPercentage: Number(marginPercentage || 0),
                totalCost,
                finalAmount,
                products: products || [],
                additionalCosts: additionalCosts || {},
                status: 'draft'
            }
        });
        res.status(201).json(newQuotation);
    }
    catch (error) {
        res.status(500).json({ message: 'Server error creating quotation' });
    }
});
// Update Quotation products
router.patch('/:id', authMiddleware_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { products, additionalCosts } = req.body;
        const productsTotal = products && Array.isArray(products)
            ? products.reduce((sum, p) => sum + Number(p.amount || 0), 0)
            : 0;
        let additionalCostsList = [];
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
        const updated = await index_1.prisma.quotation.update({
            where: { id: String(id) },
            data: {
                products: products || [],
                ...(additionalCosts !== undefined ? { additionalCosts } : {}),
                totalCost,
                finalAmount: totalCost,
            },
            include: {
                project: {
                    include: { slabs: true }
                }
            }
        });
        // Auto-generate Slabs if project is already an active work order and has no slabs
        const activeStatuses = ['shop_drawing', 'material_planning', 'production', 'work_order', 'completed'];
        console.log('Quotation Update Check:', {
            status: updated.project?.status,
            isActive: updated.project?.status ? activeStatuses.includes(updated.project.status) : false,
            slabsLength: updated.project?.slabs?.length,
            hasProducts: !!updated.products
        });
        if (updated.project?.status && activeStatuses.includes(updated.project.status) && updated.project.slabs.length === 0 && updated.products) {
            console.log('Generating slabs...');
            const productsList = updated.products;
            for (const prod of productsList) {
                const qty = Number(prod.qty) || 1;
                for (let i = 1; i <= qty; i++) {
                    const pieceName = qty > 1 ? `${prod.category || 'Product'} ${i}` : (prod.category || 'Product');
                    const sizeStr = `${prod.length || 0}L x ${prod.width || 0}W ${prod.breadth ? `| ${prod.breadth}MM` : ''}`;
                    await index_1.prisma.slab.create({
                        data: {
                            projectId: updated.projectId,
                            name: pieceName,
                            size: sizeStr,
                            status: 'pending'
                        }
                    });
                }
            }
        }
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error updating quotation' });
    }
});
exports.default = router;
//# sourceMappingURL=quotationRoutes.js.map