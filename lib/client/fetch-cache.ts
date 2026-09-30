/** Browser cache so route switches paint instantly — survives refresh via sessionStorage. */

type Entry = { value: unknown; at: number };

const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
const DEFAULT_TTL_MS = 5 * 60_000;
const SESSION_MAX_AGE_MS = 30 * 60_000;
const STORAGE_KEY = "commerceops:page-cache:v1";

let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

function hydrateFromSession() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Entry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.at !== "number") continue;
      if (now - entry.at > SESSION_MAX_AGE_MS) continue;
      store.set(key, entry);
    }
  } catch {
    // ignore corrupt cache
  }
}

function schedulePersist() {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const obj: Record<string, Entry> = {};
      for (const [key, entry] of store.entries()) obj[key] = entry;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // quota / private mode
    }
  }, 80);
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNotify() {
  if (notifyTimer) return;
  // Defer so setState updaters never trigger store subscribers mid-render.
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    notify();
  }, 0);
}

export function subscribeClientCache(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clientCacheGet<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | undefined {
  hydrateFromSession();
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) return undefined;
  return hit.value as T;
}

/** Return value even if past ttl (stale-while-revalidate). */
export function clientCachePeek<T>(key: string): T | undefined {
  hydrateFromSession();
  return store.get(key)?.value as T | undefined;
}

export function clientCacheSet(key: string, value: unknown) {
  hydrateFromSession();
  store.set(key, { value, at: Date.now() });
  schedulePersist();
  scheduleNotify();
}

export function clientCacheInvalidate(prefix?: string) {
  hydrateFromSession();
  if (!prefix) {
    store.clear();
  } else {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  }
  schedulePersist();
  scheduleNotify();
}

const inflight = new Map<string, Promise<unknown>>();

/** Prefetch JSON into the client cache (deduped, fire-and-forget). */
export function clientPrefetchJson(
  key: string,
  url: string,
  select: (json: unknown) => unknown = (j) => j,
  opts: { force?: boolean } = {},
) {
  if (typeof window === "undefined") return;
  hydrateFromSession();
  if (!opts.force && clientCacheGet(key)) return;
  if (inflight.has(key)) return;

  const run = fetch(url)
    .then(async (r) => {
      if (!r.ok) return;
      clientCacheSet(key, select(await r.json()));
    })
    .catch(() => undefined)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, run);
}

export type PagePrefetch = {
  key: string;
  url: string;
  select?: (json: unknown) => unknown;
};

/** Shared nav → API warm map (used by sidebar hover/click). */
export const PAGE_DATA_PREFETCH: Record<string, PagePrefetch[]> = {
  "/": [{ key: "dashboard:metrics", url: "/api/dashboard" }],
  "/tasks": [
    {
      key: "tasks:list",
      url: "/api/tasks",
      select: (j) => (j as { tasks?: unknown[] }).tasks || [],
    },
  ],
  "/orders": [
    {
      key: "orders:list",
      url: "/api/orders",
      select: (j) => (j as { orders?: unknown[] }).orders || [],
    },
  ],
  "/customers": [
    {
      key: "customers:list",
      url: "/api/customers",
      select: (j) => (j as { customers?: unknown[] }).customers || [],
    },
  ],
  "/tickets": [
    {
      key: "tickets:list",
      url: "/api/tickets",
      select: (j) => ({
        tickets: (j as { tickets?: unknown[] }).tickets || [],
        counts: (j as { counts?: Record<string, number> }).counts || {},
      }),
    },
  ],
  "/triggers": [
    {
      key: "triggers:list",
      url: "/api/triggers",
      select: (j) => ({
        triggers: (j as { triggers?: unknown[] }).triggers || [],
        messages: (j as { messages?: unknown[] }).messages || [],
      }),
    },
  ],
  "/logs": [
    {
      key: "executions:list",
      url: "/api/executions",
      select: (j) => (j as { executions?: unknown[] }).executions || [],
    },
  ],
  "/settings": [{ key: "settings", url: "/api/settings" }],
  "/evaluations": [{ key: "evaluations", url: "/api/evaluations" }],
};

export function prefetchPageData(href: string, force = false) {
  const items = PAGE_DATA_PREFETCH[href];
  if (!items) return;
  for (const item of items) {
    clientPrefetchJson(item.key, item.url, item.select, { force });
  }
}

export function warmAllPageData() {
  for (const href of Object.keys(PAGE_DATA_PREFETCH)) {
    prefetchPageData(href);
  }
}
