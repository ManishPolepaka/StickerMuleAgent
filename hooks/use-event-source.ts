"use client";

import { useEffect, useRef } from "react";
import { agentDebug, agentDebugWarn } from "@/lib/client/agent-debug";

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

    agentDebug("sse", `connecting ${url}`);

    const flush = () => {
      const batch = queueRef.current;
      queueRef.current = [];
      for (const data of batch) {
        handlerRef.current(data);
      }
    };

    const es = new EventSource(url);
    es.onopen = () => {
      agentDebug("sse", `open ${url}`);
    };
    es.onerror = () => {
      agentDebugWarn("sse", `error/retry ${url}`, { readyState: es.readyState });
    };
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as Record<string, unknown>;
        agentDebug("sse", `event ${String(data.type || "?")}`, data);
        if (data.type === "connected") {
          handlerRef.current(data);
          return;
        }
        queueRef.current.push(data);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, 150);
      } catch {
        agentDebugWarn("sse", "malformed frame", msg.data);
      }
    };

    return () => {
      agentDebug("sse", `closing ${url}`);
      if (timerRef.current) clearTimeout(timerRef.current);
      flush();
      es.close();
    };
  }, [url, enabled]);
}
