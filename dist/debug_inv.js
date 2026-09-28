"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
async function run() {
    const invs = await index_1.prisma.inventory.findMany({
        where: { jobWorkType: 'company' },
        include: {
            projectMaterials: {
                include: {
                    project: true
                }
            },
            slabs: {
                include: {
                    project: true
                }
            }
        }
    });
    console.log('Company invs total:', invs.length);
    const withProj = invs.filter(i => (i.projectMaterials && i.projectMaterials.length > 0) || (i.slabs && i.slabs.length > 0));
    console.log('Company invs with project:', withProj.length);
    const projNames = new Set();
    withProj.forEach(i => {
        i.projectMaterials?.forEach(pm => projNames.add(pm.project?.name + ' / ' + pm.project?.clientName));
        i.slabs?.forEach(s => projNames.add(s.project?.name + ' / ' + s.project?.clientName));
    });
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const pm = await db.collection('ProjectMaterial').findOne({});
    console.log('ProjectMaterial projectId:', typeof pm.projectId, pm.projectId?.constructor?.name, pm.projectId);
    console.log('ProjectMaterial inventoryId:', typeof pm.inventoryId, pm.inventoryId?.constructor?.name, pm.inventoryId);
    const inv = await db.collection('Inventory').findOne({ _id: pm.inventoryId });
    console.log('Found inv with pm.inventoryId?:', !!inv);
    const invStr = await db.collection('Inventory').findOne({ _id: new mongoose.Types.ObjectId(pm.inventoryId) });
    console.log('Found inv with ObjectId?:', !!invStr);
    const clientInvs = await index_1.prisma.inventory.findMany({
        where: { jobWorkType: 'client' },
        include: {
            projectMaterials: {
                include: {
                    project: true
                }
            }
        }
    });
    console.log('Client invs total:', clientInvs.length);
    const clientSuppliers = new Set();
    clientInvs.forEach(i => clientSuppliers.add(i.supplier));
    console.log('Client suppliers:', Array.from(clientSuppliers));
    process.exit(0);
}
run().catch(console.error);
//# sourceMappingURL=debug_inv.js.map