"use client";

import { useEffect, useRef } from "react";

type Handler = (data: Record<string, unknown>) => void;

/**
 * SSE helper. Batches bursts without dropping event types — previous debounce
 * only forwarded the last message, so task_updated was often lost when
 * dashboard_changed arrived ~ms later.
 */
export function useEventSource(url: string | null, onEvent: Handler, enabled = true) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (!url || !enabled) return;

    const flush = () => {
      const batch = queueRef.current;
      queueRef.current = [];
      for (const data of batch) {
        handlerRef.current(data);
      }
    };

    const es = new EventSource(url);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as Record<string, unknown>;
        if (data.type === "connected") {
          handlerRef.current(data);
          return;
        }
        queueRef.current.push(data);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, 150);
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      flush();
      es.close();
    };
  }, [url, enabled]);
}
