import cron from 'node-cron';
import { prisma } from '../index';

export const initCronJobs = () => {
  // Run on the 1st of every month at 00:01
  // This will calculate the closing stock of the previous month and save it as the opening stock of the current month
  cron.schedule('1 0 1 * *', async () => {
    console.log('[CRON] Running End of Month Stock Snapshot...');
    try {
      const inventoryItems = await prisma.inventory.findMany();
      
      const snapshotDate = new Date(); // It's the 1st of the month
      
      for (const item of inventoryItems) {
        await prisma.dailyStockBalance.create({
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
    } catch (error) {
      console.error('[CRON] Error running stock snapshot:', error);
    }
  });
};
