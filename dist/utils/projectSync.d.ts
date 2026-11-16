export declare const invalidateProjectCaches: (projectId?: string) => void;
export declare const formatProductToSlabSize: (prod: any) => string;
export declare const parseSlabToProduct: (slab: any, existingProduct?: any) => {
    photo?: any;
    id: any;
    slabId: any;
    category: any;
    productName: any;
    name: any;
    unit: any;
    dimensionUnit: any;
    length: number;
    width: number;
    breadth: number;
    thickness: number;
    qty: number;
    rate: number;
    amount: number;
    sqft: number;
};
export declare const normalizeQuotationProduct: (prod: any, index: number, existingProd?: any) => {
    photo?: any;
    category: any;
    productName: any;
    name: any;
    unit: any;
    dimensionUnit: string;
    length: number;
    width: number;
    breadth: number;
    thickness: number;
    qty: number;
    rate: number;
    amount: number;
    sqft: number;
    slabId?: any;
    id: any;
};
/**
 * Syncs Slab records from an incoming products list (from Edit Work Order Details or Costing & Quotation)
 * and ensures Quotation.products and Slab collection are 100% in sync.
 */
export declare const syncSlabsAndQuotationFromProducts: (projectId: string, incomingProducts: any[], options?: {
    removeUnmatchedSlabs?: boolean;
    updateQuotationRecord?: boolean;
}) => Promise<any[]>;
/**
 * Syncs Quotation.products from current Slab records in the database
 * (called when slabs are added/edited/deleted in Slabs & Production Planning or Master Maker).
 */
export declare const syncQuotationFromSlabs: (projectId: string) => Promise<{
    photo?: any;
    id: any;
    slabId: any;
    category: any;
    productName: any;
    name: any;
    unit: any;
    dimensionUnit: any;
    length: number;
    width: number;
    breadth: number;
    thickness: number;
    qty: number;
    rate: number;
    amount: number;
    sqft: number;
}[]>;
/**
 * Merges slabs into quotation products in-memory (and triggers background DB sync if out of sync)
 * so GET /api/projects and GET /api/projects/:id always return complete products.
 */
export declare const ensureMergedProductsForProject: (projectId: string, slabs: any[], quotations: any[]) => {
    products: any[];
    quotations: any[];
    needsDbSync: boolean;
};
//# sourceMappingURL=projectSync.d.ts.map