"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  clientCachePeek,
  clientCacheSet,
  subscribeClientCache,
} from "@/lib/client/fetch-cache";
import { fetchJson } from "@/lib/client/fetch-json";

/** Safe cache read: undefined on server/hydration, live value after hydrate. */
export function useClientCacheSnapshot<T>(key: string): T | undefined {
  return useSyncExternalStore(
    subscribeClientCache,
    () => clientCachePeek<T>(key),
    () => undefined,
  );
}

/**
 * Paint from cache after hydration, then revalidate in the background.
 * Avoids SSR/sessionStorage hydration mismatches.
 */
export function useCachedJson<T>(
  key: string,
  url: string,
  select: (json: unknown) => T,
  initial?: T,
) {
  const selectRef = useRef(select);
  selectRef.current = select;

  const cached = useClientCacheSnapshot<T>(key);
  const [data, setData] = useState<T | undefined>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(initial === undefined && cached === undefined);

  const reload = useCallback(() => {
    return fetchJson(url, { retries: 3 })
      .then((json) => {
        const next = selectRef.current(json);
        clientCacheSet(key, next);
        setData(next);
        setError(null);
        setLoading(false);
        return next;
      })
      .catch((e) => {
        // Keep showing cached/initial data during transient Fast Refresh 404s.
        setLoading(false);
        setData((prev) => {
          if (prev !== undefined) {
            setError(null);
            return prev;
          }
          const peek = clientCachePeek<T>(key);
          if (peek !== undefined) {
            setError(null);
            return peek;
          }
          setError(e instanceof Error ? e.message : "Request failed");
          return prev;
        });
      });
  }, [key, url]);

  useEffect(() => {
    if (initial !== undefined) {
      clientCacheSet(key, initial);
      setData(initial);
      setLoading(false);
    }
  }, [initial, key]);

  useEffect(() => {
    if (data === undefined && cached !== undefined) {
      setData(cached);
      setLoading(false);
    }
  }, [cached, data]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolved = data ?? cached ?? initial;

  return {
    data: resolved,
    setData,
    error,
    loading: resolved === undefined && loading,
    reload,
  };
}
