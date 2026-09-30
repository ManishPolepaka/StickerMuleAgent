"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useEventSource } from "@/hooks/use-event-source";
import { cn } from "@/lib/utils";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  href?: string;
  at: number;
  read: boolean;
  kind: "routing" | "task" | "approval" | "info";
};

const MAX_ITEMS = 30;

function formatTime(ts: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

export function GlobalNotificationBell() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);

  const push = useCallback((n: Omit<AppNotification, "id" | "at" | "read">) => {
    setItems((prev) => {
      const next: AppNotification = {
        ...n,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        read: false,
      };
      return [next, ...prev].slice(0, MAX_ITEMS);
    });
  }, []);

  useEventSource("/api/realtime/stream", (event) => {
    if (event.type === "connected") {
      setLive(true);
      return;
    }
    if (event.type === "routing_started") {
      push({
        kind: "routing",
        title: String(event.label || "Routing…"),
        body: String(event.detail || "Classifying event and deciding whether to start an agent."),
        href: "/triggers",
      });
      return;
    }
    if (event.type === "trigger_processed") {
      const taskNumber = event.taskNumber ? String(event.taskNumber) : null;
      const taskId = event.taskId ? String(event.taskId) : null;
      const status = String(event.status || "");
      push({
        kind: status === "agent_started" ? "task" : "info",
        title:
          status === "agent_started"
            ? "Investigation started"
            : status === "skipped"
              ? "Trigger skipped"
              : "Routing finished",
        body:
          String(event.summary || "") ||
          (taskNumber
            ? `${taskNumber} · ${String(event.triggerType || "trigger").replaceAll("_", " ")}`
            : `${String(event.triggerType || "trigger").replaceAll("_", " ")} · ${status}`),
        href: taskId ? `/tasks/${taskId}` : "/triggers",
      });
      return;
    }
    if (event.type === "task_updated") {
      const status = event.status ? String(event.status) : "updated";
      if (status === "pending" || status === "running") return;
      push({
        kind: status === "awaiting_approval" ? "approval" : "task",
        title: event.taskNumber ? String(event.taskNumber) : "Task updated",
        body: `Status: ${status.replaceAll("_", " ")}`,
        href: event.taskId ? `/tasks/${String(event.taskId)}` : "/tasks",
      });
      return;
    }
    if (event.type === "approval_requested") {
      push({
        kind: "approval",
        title: "Approval required",
        body: "An agent paused for human review.",
        href: event.taskId ? `/tasks/${String(event.taskId)}` : "/tasks",
      });
    }
  });

  const unread = useMemo(() => items.filter((i) => !i.read).length, [items]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-notification-root]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function markAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  }

  return (
    <div className="relative" data-notification-root>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markAllRead();
        }}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900",
          open && "border-blue-200 bg-blue-50 text-blue-700",
        )}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
        <span
          className={cn(
            "absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full",
            live ? "bg-emerald-500" : "bg-slate-300",
          )}
        />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
            <div>
              <div className="text-sm font-semibold text-slate-900">Notifications</div>
              <div className="text-[11px] text-slate-500">
                {live ? "Live across all pages" : "Connecting…"}
              </div>
            </div>
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                No notifications yet. Simulate a message on Triggers & Inbox.
              </p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href || "/triggers"}
                  onClick={() => {
                    setItems((prev) =>
                      prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
                    );
                    setOpen(false);
                  }}
                  className={cn(
                    "block border-b border-slate-50 px-3 py-2.5 transition hover:bg-slate-50",
                    !n.read && "bg-blue-50/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{n.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</div>
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">{formatTime(n.at)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Persistent strip so the bell is visible on every page, including task detail. */
export function GlobalTopBar() {
  return (
    <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-end gap-2 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md sm:px-6">
      <GlobalNotificationBell />
    </div>
  );
}
