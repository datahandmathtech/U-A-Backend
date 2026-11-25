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
export declare const ACTIVE_CHAT_PROJECT_STATUSES: Set<string>;
/**
 * Computes whether a Work Order has reached completion either explicitly (status/closure)
 * or via 100% finished slabs/pieces across its production stages.
 */
export declare const isWorkOrder100PercentDone: (project: any, closedIds?: Set<string>, slabs?: any[], piecesBySlab?: Map<string, any[]>, logsByPiece?: Map<string, any[]>) => boolean;
/**
 * Computes whether a project should be excluded from active Chat Rooms / unread notifications
 * because it is completed, closed, cancelled/pending, disabled, or 100% finished across its slabs/pieces.
 */
export declare const isProjectCompletedForChat: (project: any, closedIds: Set<string>, slabs?: any[], piecesBySlab?: Map<string, any[]>, logsByPiece?: Map<string, any[]>) => boolean;
export declare const normalizeReadBy: (rawReadBy: any) => ChatReadReceipt[];
/**
 * Determines whether a chat message is unread for a given user login.
 * Legacy messages created prior to multi-user readBy tracking are only marked unread
 * for admins/managers when isReadByAdmin is false so existing staff logins are not flooded.
 */
export declare const isMessageUnreadForViewer: (msg: any, viewerId: string, viewerRole: string) => boolean;
/**
 * Computes independent date windows for the selected Financial Year (Bottom 4 KPIs)
 * and selected Month within that Financial Year (Top 4 KPIs).
 */
export declare const computeDashboardDateRanges: (fy?: string | null, month?: string | number | null) => DashboardDateRanges;
//# sourceMappingURL=dashboardChatHelpers.d.ts.map