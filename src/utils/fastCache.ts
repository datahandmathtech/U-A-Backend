// High performance In-Memory Cache for Express API endpoints
interface CacheEntry {
  data: any;
  expiresAt: number;
}

const cacheStore = new Map<string, CacheEntry>();

export const fastCache = {
  get(key: string): any | null {
    const entry = cacheStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cacheStore.delete(key);
      return null;
    }
    return entry.data;
  },

  set(key: string, data: any, ttlSeconds: number = 8): void {
    cacheStore.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  },

  invalidate(prefixOrPattern?: string): void {
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

  clearAll(): void {
    cacheStore.clear();
  }
};
