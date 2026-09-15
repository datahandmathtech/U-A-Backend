export declare const fastCache: {
    get(key: string): any | null;
    set(key: string, data: any, ttlSeconds?: number): void;
    invalidate(prefixOrPattern?: string): void;
    clearAll(): void;
};
//# sourceMappingURL=fastCache.d.ts.map