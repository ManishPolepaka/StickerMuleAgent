import { cacheGetStale, cacheSet } from "@/lib/cache/memory";

/** Stale-while-revalidate for a single cache key. */
export function createStaticSwrLoader<T>(key: string, loader: () => Promise<T>, ttlMs = 15_000) {
  let inflight: Promise<T> | null = null;

  async function refresh(): Promise<T> {
    if (inflight) return inflight;
    inflight = loader()
      .then((value) => {
        cacheSet(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function get(): Promise<T> {
    const hit = cacheGetStale<T>(key);
    if (hit?.fresh) return hit.value;
    if (hit && !hit.fresh) {
      void refresh().catch(() => undefined);
      return hit.value;
    }
    return refresh();
  }

  return { get, warm: async () => { await refresh(); }, refresh };
}

/** Stale-while-revalidate keyed by id (e.g. task detail). */
export function createKeyedSwrLoader<T>(
  keyFn: (id: string) => string,
  loader: (id: string) => Promise<T>,
  ttlMs = 15_000,
) {
  const inflight = new Map<string, Promise<T>>();

  async function refresh(id: string): Promise<T> {
    const key = keyFn(id);
    const existing = inflight.get(key);
    if (existing) return existing;
    const run = loader(id)
      .then((value) => {
        cacheSet(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, run);
    return run;
  }

  async function get(id: string): Promise<T> {
    const key = keyFn(id);
    const hit = cacheGetStale<T>(key);
    if (hit?.fresh) return hit.value;
    if (hit && !hit.fresh) {
      void refresh(id).catch(() => undefined);
      return hit.value;
    }
    return refresh(id);
  }

  return { get, warm: async (id: string) => { await refresh(id); }, refresh };
}
