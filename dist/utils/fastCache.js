"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fastCache = void 0;
const cacheStore = new Map();
exports.fastCache = {
    get(key) {
        const entry = cacheStore.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            cacheStore.delete(key);
            return null;
        }
        return entry.data;
    },
    set(key, data, ttlSeconds = 8) {
        cacheStore.set(key, {
            data,
            expiresAt: Date.now() + ttlSeconds * 1000
        });
    },
    invalidate(prefixOrPattern) {
        if (!prefixOrPattern) {
            cacheStore.clear();
            return;
        }
        for (const key of Array.from(cacheStore.keys())) {
            if (key.includes(prefixOrPattern)) {
                cacheStore.delete(key);
            }
        }
    },
    clearAll() {
        cacheStore.clear();
    }
};
//# sourceMappingURL=fastCache.js.map