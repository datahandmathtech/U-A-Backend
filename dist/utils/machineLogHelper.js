"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoSplitActiveMachineLogs = autoSplitActiveMachineLogs;
let isSplitting = false;
async function autoSplitActiveMachineLogs() {
    if (isSplitting)
        return;
    isSplitting = true;
    try {
        const mongoose = require('mongoose');
        let db = mongoose.connection?.db;
        if (!db || mongoose.connection.readyState !== 1) {
            isSplitting = false;
            return; // Skip this run if DB is not ready. Cron will retry in 5 minutes.
        }
        const raw = await db.collection('MachineLog').find({ status: 'active' }).toArray();
        const activeLogs = raw.map((l) => ({
            id: l._id.toString(),
            machineId: l.machineId ? l.machineId.toString() : null,
            projectId: l.projectId ? l.projectId.toString() : null,
            productId: l.productId ? l.productId.toString() : null,
            productName: l.productName,
            startTime: l.startTime,
            endTime: l.endTime,
            estimatedHours: l.estimatedHours,
            quantityProduced: l.quantityProduced,
            operatorId: l.operatorId ? l.operatorId.toString() : null,
            machinePhotoUrl: l.machinePhotoUrl,
            unitPhotoUrl: l.unitPhotoUrl,
            softwarePhotoUrl: l.softwarePhotoUrl,
            status: l.status,
            approvalStatus: l.approvalStatus,
            isCarryForward: l.isCarryForward,
            parentLogId: l.parentLogId ? l.parentLogId.toString() : null,
            remarks: l.remarks
        }));
        const now = new Date();
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 mins (Asia/Kolkata)
        for (const log of activeLogs) {
            if (!log.machineId)
                continue;
            let currentLogId = log.id;
            let currentLogStart = new Date(log.startTime);
            const rootParentId = log.parentLogId || log.id;
            let maxIterations = 35;
            while (maxIterations-- > 0) {
                // Calculate IST midnight bounds
                const istStart = new Date(currentLogStart.getTime() + IST_OFFSET_MS);
                const year = istStart.getUTCFullYear();
                const month = istStart.getUTCMonth();
                const day = istStart.getUTCDate();
                // 23:59:59.999 IST converted back to UTC
                const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
                // 00:00:00.000 IST next day converted back to UTC
                const nextDayStart = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0) - IST_OFFSET_MS);
                // If endOfDay is strictly in the past compared to current time 'now'
                if (endOfDay.getTime() < now.getTime()) {
                    // This log crosses midnight!
                    // 1. Close the current log at 23:59:59.999 of its day (IST)
                    const runHours = Math.max(0, (endOfDay.getTime() - currentLogStart.getTime()) / (1000 * 60 * 60));
                    const remarks = log.remarks ? `${log.remarks} (Auto-closed at 12:00 AM midnight)`.trim() : 'Auto-closed at 12:00 AM midnight (Carry Forward)';
                    await db.collection('MachineLog').updateOne({ _id: new mongoose.Types.ObjectId(currentLogId) }, { $set: { endTime: endOfDay, status: 'completed', remarks, updatedAt: new Date() } });
                    // Increment machine total run hours
                    if (runHours > 0) {
                        await db.collection('Machine').updateOne({ _id: new mongoose.Types.ObjectId(log.machineId) }, { $inc: { totalRunHours: runHours }, $set: { updatedAt: new Date() } });
                    }
                    // Deduplication: ensure an active log does not already exist for this machine on nextDayStart
                    const existingActive = await db.collection('MachineLog').findOne({
                        machineId: new mongoose.Types.ObjectId(log.machineId),
                        status: 'active',
                        startTime: nextDayStart
                    });
                    if (existingActive) {
                        currentLogId = existingActive._id.toString();
                        currentLogStart = nextDayStart;
                        continue;
                    }
                    const newDoc = {
                        machineId: new mongoose.Types.ObjectId(log.machineId),
                        projectId: log.projectId ? new mongoose.Types.ObjectId(log.projectId) : null,
                        productId: log.productId ? new mongoose.Types.ObjectId(log.productId) : null,
                        productName: log.productName,
                        startTime: nextDayStart,
                        estimatedHours: log.estimatedHours || 0,
                        operatorId: log.operatorId ? new mongoose.Types.ObjectId(log.operatorId) : null,
                        machinePhotoUrl: log.machinePhotoUrl,
                        unitPhotoUrl: log.unitPhotoUrl,
                        softwarePhotoUrl: log.softwarePhotoUrl,
                        status: 'active',
                        approvalStatus: 'in_progress',
                        isCarryForward: true,
                        parentLogId: new mongoose.Types.ObjectId(rootParentId),
                        remarks: `Carry Forward from ${currentLogStart.toLocaleDateString('en-GB')}`,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };
                    const insertRes = await db.collection('MachineLog').insertOne(newDoc);
                    // Update local variables for next day loop iteration if it spans multiple past days
                    currentLogId = insertRes.insertedId.toString();
                    currentLogStart = nextDayStart;
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
    finally {
        isSplitting = false;
    }
}
//# sourceMappingURL=machineLogHelper.js.map