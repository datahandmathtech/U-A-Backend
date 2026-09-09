"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoSplitActiveMachineLogs = autoSplitActiveMachineLogs;
const index_1 = require("../index");
async function autoSplitActiveMachineLogs() {
    try {
        // Find all active logs
        const activeLogs = await index_1.prisma.machineLog.findMany({
            where: { status: 'active' }
        });
        const now = new Date();
        for (const log of activeLogs) {
            let logId = log.id;
            let logStart = new Date(log.startTime);
            while (true) {
                // Find the end of logStart's day: 23:59:59.999
                const endOfDay = new Date(logStart);
                endOfDay.setHours(23, 59, 59, 999);
                // If endOfDay is in the past compared to current time 'now'
                if (endOfDay < now) {
                    // This log crosses midnight!
                    // 1. Close the current log at 23:59:59.999 of its day
                    await index_1.prisma.machineLog.update({
                        where: { id: logId },
                        data: {
                            endTime: endOfDay,
                            status: 'completed'
                        }
                    });
                    // Increment machine total run hours
                    const runHours = (endOfDay.getTime() - logStart.getTime()) / (1000 * 60 * 60);
                    await index_1.prisma.machine.update({
                        where: { id: log.machineId },
                        data: { totalRunHours: { increment: runHours } }
                    });
                    // 2. Start a new log for the next day at 00:00:00.000
                    const nextDayStart = new Date(endOfDay.getTime() + 1); // 1 ms after 23:59:59.999 is 00:00:00.000 of next day
                    const newLog = await index_1.prisma.machineLog.create({
                        data: {
                            machineId: log.machineId,
                            projectId: log.projectId,
                            startTime: nextDayStart,
                            operatorId: log.operatorId,
                            machinePhotoUrl: log.machinePhotoUrl,
                            unitPhotoUrl: log.unitPhotoUrl,
                            softwarePhotoUrl: log.softwarePhotoUrl,
                            status: 'active',
                            approvalStatus: log.approvalStatus,
                            remarks: log.remarks
                        }
                    });
                    // Update local variables for subsequent loops
                    logId = newLog.id;
                    logStart = nextDayStart;
                }
                else {
                    break;
                }
            }
        }
    }
    catch (error) {
        console.error("Error in autoSplitActiveMachineLogs:", error);
    }
}
//# sourceMappingURL=machineLogHelper.js.map