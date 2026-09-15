import { prisma } from '../index';

export async function autoSplitActiveMachineLogs() {
  try {
    // Find all active logs
    const activeLogs = await prisma.machineLog.findMany({
      where: { status: 'active' }
    });

    const now = new Date();
    
    for (const log of activeLogs) {
      let currentLogId = log.id;
      let currentLogStart = new Date(log.startTime);
      const rootParentId = log.parentLogId || log.id;
      
      while (true) {
        // Find the end of currentLogStart's day: 23:59:59.999
        const endOfDay = new Date(currentLogStart);
        endOfDay.setHours(23, 59, 59, 999);
        
        // If endOfDay is strictly in the past compared to current time 'now'
        if (endOfDay.getTime() < now.getTime()) {
          // This log crosses midnight!
          // 1. Close the current log at 23:59:59.999 of its day
          const runHours = Math.max(0, (endOfDay.getTime() - currentLogStart.getTime()) / (1000 * 60 * 60));
          
          await prisma.machineLog.update({
            where: { id: currentLogId },
            data: {
              endTime: endOfDay,
              status: 'completed',
              remarks: log.remarks ? `${log.remarks} (Auto-closed at 12:00 AM midnight)`.trim() : 'Auto-closed at 12:00 AM midnight (Carry Forward)'
            }
          });
          
          // Increment machine total run hours
          if (runHours > 0) {
            await prisma.machine.update({
              where: { id: log.machineId },
              data: { totalRunHours: { increment: runHours } }
            });
          }
          
          // 2. Start a new carry-forward log for the next day at 00:00:00.000
          const nextDayStart = new Date(endOfDay.getTime() + 1); // 1 ms after 23:59:59.999 is 00:00:00.000 of next day
          
          const newLog = await prisma.machineLog.create({
            data: {
              machineId: log.machineId,
              projectId: log.projectId,
              productId: log.productId,
              productName: log.productName,
              startTime: nextDayStart,
              estimatedHours: log.estimatedHours || 0,
              operatorId: log.operatorId,
              machinePhotoUrl: log.machinePhotoUrl,
              unitPhotoUrl: log.unitPhotoUrl,
              softwarePhotoUrl: log.softwarePhotoUrl,
              status: 'active',
              approvalStatus: 'in_progress',
              isCarryForward: true,
              parentLogId: rootParentId,
              remarks: log.remarks ? `Carry Forward from ${currentLogStart.toLocaleDateString('en-GB')}` : `Carry Forward from ${currentLogStart.toLocaleDateString('en-GB')}`
            }
          });
          
          // Update local variables for next day loop iteration if it spans multiple past days
          currentLogId = newLog.id;
          currentLogStart = nextDayStart;
        } else {
          break;
        }
      }
    }
  } catch (error) {
    console.error("Error in autoSplitActiveMachineLogs:", error);
  }
}
