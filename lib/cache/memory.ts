type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

/** Fresh hit only (expired entries are ignored). */
export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) return undefined;
  return hit.value as T;
}

/** Return cached value even if expired (stale-while-revalidate). */
export function cacheGetStale<T>(key: string): { value: T; fresh: boolean } | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  return { value: hit.value as T, fresh: Date.now() <= hit.expiresAt };
}

export function cacheSet<T>(key: string, value: T, ttlMs = 4000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheInvalidate(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
