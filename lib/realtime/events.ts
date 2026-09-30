type RealtimeListener = (event: RealtimeEvent) => void;

export type RealtimeEvent =
  | {
      type: "task_updated";
      taskId: string;
      status?: string;
      taskNumber?: string;
    }
  | {
      type: "step_added";
      taskId: string;
      executionId: string;
      step: {
        id: string;
        stepIndex: number;
        stepType: string;
        title: string;
        detail: string | null;
        toolName: string | null;
        toolInputJson: string | null;
        toolResultJson: string | null;
        status: string;
        createdAt: string;
      };
    }
  | {
      type: "approval_requested";
      taskId: string;
      approvalId: string;
    }
  | {
      type: "trigger_processed";
      triggerId: string;
      triggerType: string;
      taskId?: string | null;
      taskNumber?: string | null;
      status: string;
      summary?: string;
    }
  | {
      type: "routing_started";
      action: string;
      label: string;
      detail?: string;
    }
  | {
      type: "dashboard_changed";
      reason: string;
    };

const globalStore = globalThis as unknown as {
  __commerceOpsListeners?: Set<RealtimeListener>;
};

function listeners() {
  if (!globalStore.__commerceOpsListeners) {
    globalStore.__commerceOpsListeners = new Set();
  }
  return globalStore.__commerceOpsListeners;
}

export function publishRealtime(event: RealtimeEvent) {
  for (const listener of listeners()) {
    try {
      listener(event);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeRealtime(listener: RealtimeListener) {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

export function sseResponse(args: {
  channel: string;
  onStart?: (send: (event: RealtimeEvent | { type: "connected"; channel: string }) => void) => void | Promise<void>;
  filter?: (event: RealtimeEvent) => boolean;
}) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ type: "connected", channel: args.channel });
      await args.onStart?.(send as (event: RealtimeEvent | { type: "connected"; channel: string }) => void);

      unsubscribe = subscribeRealtime((event) => {
        if (args.filter && !args.filter(event)) return;
        send(event);
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
