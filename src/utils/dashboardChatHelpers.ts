export interface ChatReadReceipt {
  userId: string;
  userName: string;
  userRole: string;
  seenAt: Date | string;
}

export interface DashboardDateRanges {
  fyRangeStart: Date | null;
  fyRangeEnd: Date | null;
  monthRangeStart: Date | null;
  monthRangeEnd: Date | null;
}

export const WORK_ORDER_CHAT_PROJECT_STATUSES = new Set([
  'shop_drawing',
  'material_planning',
  'production',
  'work_order',
  'completed'
]);

export const ACTIVE_CHAT_PROJECT_STATUSES = new Set([
  'shop_drawing',
  'material_planning',
  'production',
  'work_order'
]);

const BASE_STAGES = ['Production', 'Bridge Cutting', 'Polishing', 'Packing', 'Dispatch'];

/**
 * Computes whether a Work Order has reached completion either explicitly (status/closure)
 * or via 100% finished slabs/pieces across its production stages.
 */
export const isWorkOrder100PercentDone = (
  project: any,
  closedIds: Set<string> = new Set(),
  slabs: any[] = [],
  piecesBySlab: Map<string, any[]> = new Map(),
  logsByPiece: Map<string, any[]> = new Map()
): boolean => {
  if (!project) return false;
  const pId = project._id ? project._id.toString() : String(project.id || '');
  const status = String(project.status || '').trim().toLowerCase();

  if (status === 'completed' || closedIds.has(pId)) return true;
  if (Number(project.progressPercentage) >= 100) return true;

  if (!Array.isArray(slabs) || slabs.length === 0) {
    return false;
  }

  let totalProductionEquivalent = 0;
  let totalSlabPercentSum = 0;
  const totalProductRows = slabs.length;

  for (const slab of slabs) {
    const sId = slab._id ? slab._id.toString() : String(slab.id || '');
    const pieces = piecesBySlab.get(sId) || slab.pieces || [];
    const totalSubPieces = pieces.length > 0 ? pieces.length : 1;

    const reqStages =
      Array.isArray(slab.requiredStages) && slab.requiredStages.length > 0
        ? slab.requiredStages.filter((s: string) => s !== 'Polishing')
        : ['Production'];

    const hasProduction = reqStages.includes('Production') || reqStages.length === 0;
    const hasBridgeCutting = reqStages.includes('Bridge Cutting');
    const hasPolishing = reqStages.some((s: string) => String(s).startsWith('Polishing'));
    const hasPacking = reqStages.includes('Packing');
    const hasDispatch = reqStages.includes('Dispatch');

    let wBridge = hasBridgeCutting ? 15 : 0;
    let wPoli = hasPolishing ? 15 : 0;
    let wPack = hasPacking ? 10 : 0;
    let wDisp = hasDispatch ? 10 : 0;
    let wProd = 0;

    if (hasProduction || hasBridgeCutting || hasPolishing || hasPacking || hasDispatch) {
      wProd = 100 - wBridge - wPoli - wPack - wDisp;
      if (!hasProduction) {
        wProd = 0;
        const remaining = wBridge + wPoli + wPack + wDisp;
        if (remaining > 0) {
          wBridge = (wBridge / remaining) * 100;
          wPoli = (wPoli / remaining) * 100;
          wPack = (wPack / remaining) * 100;
          wDisp = (wDisp / remaining) * 100;
        }
      }
    }

    const getStageCompletionRatio = (stageName: string) => {
      if (pieces.length === 0) {
        return slab.status === 'completed' ? 1.0 : 0;
      }
      const stageIdx = BASE_STAGES.indexOf(stageName);
      let completedCount = 0;

      for (const pc of pieces) {
        if (pc.status === 'pending' || pc.status === 'not_started') continue;

        const pcId = pc._id ? pc._id.toString() : String(pc.id || '');
        const pcLogs = logsByPiece.get(pcId) || pc.logs || [];
        const pStage = (String(pc.stage || 'Production').split(' - ')[0] || '').replace(' Work', '').trim();
        const pIdx = BASE_STAGES.indexOf(pStage);

        const hasLog = pcLogs.some((l: any) => {
          const lStage = (String(l.stage || '').split(' - ')[0] || '').replace(' Work', '').trim();
          return (
            (lStage === stageName || lStage.startsWith(stageName)) &&
            (l.status === 'completed' || l.status === 'approved')
          );
        });

        if (hasLog || (pStage === stageName && pc.status === 'completed') || pIdx > stageIdx) {
          completedCount++;
        }
      }
      return Math.min(1.0, completedCount / totalSubPieces);
    };

    const cProd = hasProduction ? (slab.status === 'completed' ? 1.0 : getStageCompletionRatio('Production')) : 0;
    const cBridge = hasBridgeCutting ? getStageCompletionRatio('Bridge Cutting') : 0;
    const cPoli = hasPolishing ? getStageCompletionRatio('Polishing') : 0;
    const cPack = hasPacking ? getStageCompletionRatio('Packing') : 0;
    const cDisp = hasDispatch ? getStageCompletionRatio('Dispatch') : 0;

    totalProductionEquivalent += cProd;
    totalSlabPercentSum += wProd * cProd + wBridge * cBridge + wPoli * cPoli + wPack * cPack + wDisp * cDisp;
  }

  let overallProgressPercent = Math.round(totalSlabPercentSum / totalProductRows);
  if (totalProductionEquivalent >= totalProductRows) {
    overallProgressPercent = 100;
  }

  return overallProgressPercent >= 100;
};

export type WorkOrderChatState = 'excluded' | 'active' | 'completed';

/**
 * Classifies a project for Unnati Chat:
 * - 'excluded': CRM enquiries, cancelled/archived entries, or rooms with chat disabled
 * - 'completed': Work Orders that are completed, closed, or 100% done across pieces
 * - 'active': Live Work Orders currently open in the production workflow
 */
export const classifyWorkOrderForChat = (
  project: any,
  closedIds: Set<string> = new Set(),
  slabs: any[] = [],
  piecesBySlab: Map<string, any[]> = new Map(),
  logsByPiece: Map<string, any[]> = new Map()
): WorkOrderChatState => {
  if (!project || project.hasChatRoom === false) return 'excluded';

  const status = String(project.status || '').trim().toLowerCase();
  if (!WORK_ORDER_CHAT_PROJECT_STATUSES.has(status)) return 'excluded';

  return isWorkOrder100PercentDone(project, closedIds, slabs, piecesBySlab, logsByPiece)
    ? 'completed'
    : 'active';
};

/**
 * Computes whether a project should be excluded from active Chat Rooms / unread notifications
 * because it is not an active Work Order (completed, closed, CRM enquiry, disabled, or 100% finished).
 */
export const isProjectCompletedForChat = (
  project: any,
  closedIds: Set<string>,
  slabs: any[] = [],
  piecesBySlab: Map<string, any[]> = new Map(),
  logsByPiece: Map<string, any[]> = new Map()
): boolean => {
  return classifyWorkOrderForChat(project, closedIds, slabs, piecesBySlab, logsByPiece) !== 'active';
};

export const normalizeReadBy = (rawReadBy: any): ChatReadReceipt[] => {
  if (!Array.isArray(rawReadBy)) return [];
  const seenMap = new Map<string, ChatReadReceipt>();
  for (const r of rawReadBy) {
    if (!r || !r.userId) continue;
    const uid = String(r.userId);
    if (!seenMap.has(uid)) {
      seenMap.set(uid, {
        userId: uid,
        userName: String(r.userName || 'User'),
        userRole: String(r.userRole || 'employee'),
        seenAt: r.seenAt || new Date()
      });
    }
  }
  return Array.from(seenMap.values());
};

/**
 * Determines whether a chat message is unread for a given user login.
 * Legacy messages created prior to multi-user readBy tracking are only marked unread
 * for admins/managers when isReadByAdmin is false so existing staff logins are not flooded.
 */
export const isMessageUnreadForViewer = (
  msg: any,
  viewerId: string,
  viewerRole: string
): boolean => {
  const senderId = msg?.senderId ? String(msg.senderId) : '';
  if (viewerId && senderId && senderId === viewerId) return false;

  const readBy = normalizeReadBy(msg?.readBy);
  if (readBy.length === 0) {
    const isAdminViewer = viewerRole === 'admin' || viewerRole === 'manager';
    return isAdminViewer && !msg?.isReadByAdmin && msg?.senderRole !== 'admin';
  }
  if (!viewerId) return false;
  return !readBy.some((r) => r.userId === viewerId);
};

/**
 * Computes independent date windows for the selected Financial Year (Bottom 4 KPIs)
 * and selected Month within that Financial Year (Top 4 KPIs).
 */
export const computeDashboardDateRanges = (
  fy?: string | null,
  month?: string | number | null
): DashboardDateRanges => {
  if (!fy || typeof fy !== 'string') {
    return {
      fyRangeStart: null,
      fyRangeEnd: null,
      monthRangeStart: null,
      monthRangeEnd: null
    };
  }

  const fyParts = fy.split('-');
  const startYear = parseInt(fyParts[0] || '', 10);
  const endYear = parseInt(fyParts[1] || '', 10);
  if (isNaN(startYear) || isNaN(endYear)) {
    return {
      fyRangeStart: null,
      fyRangeEnd: null,
      monthRangeStart: null,
      monthRangeEnd: null
    };
  }

  // Indian Financial Year: April 1 (month 3) of startYear to March 31 (month 2) of endYear
  const fyRangeStart = new Date(startYear, 3, 1);
  const fyRangeEnd = new Date(endYear, 2, 31, 23, 59, 59, 999);

  let monthRangeStart = fyRangeStart;
  let monthRangeEnd = fyRangeEnd;

  if (month !== undefined && month !== null && month !== '') {
    const monthNum = typeof month === 'number' ? month : parseInt(String(month), 10);
    if (!isNaN(monthNum) && monthNum >= 0 && monthNum <= 11) {
      const year = monthNum >= 3 && monthNum <= 11 ? startYear : endYear;
      monthRangeStart = new Date(year, monthNum, 1);
      monthRangeEnd = new Date(year, monthNum + 1, 0, 23, 59, 59, 999);
    }
  }

  return {
    fyRangeStart,
    fyRangeEnd,
    monthRangeStart,
    monthRangeEnd
  };
};
