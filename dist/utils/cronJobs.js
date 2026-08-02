"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCronJobs = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const index_1 = require("../index");
const initCronJobs = () => {
    // Run on the 1st of every month at 00:01
    // This will calculate the closing stock of the previous month and save it as the opening stock of the current month
    node_cron_1.default.schedule('1 0 1 * *', async () => {
        console.log('[CRON] Running End of Month Stock Snapshot...');
        try {
            const inventoryItems = await index_1.prisma.inventory.findMany();
            const snapshotDate = new Date(); // It's the 1st of the month
            for (const item of inventoryItems) {
                await index_1.prisma.dailyStockBalance.create({
                    data: {
                        inventoryId: item.id,
                        date: snapshotDate,
                        openingQty: item.quantity,
                        inQty: 0,
                        outQty: 0,
                        closingQty: item.quantity
                    }
                });
            }
            console.log('[CRON] End of Month Stock Snapshot Completed Successfully.');
        }
        catch (error) {
            console.error('[CRON] Error running stock snapshot:', error);
        }
    });
};
exports.initCronJobs = initCronJobs;
//# sourceMappingURL=cronJobs.js.map