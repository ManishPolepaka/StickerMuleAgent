"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { RunInvestigationButton } from "@/components/run-investigation-button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEventSource } from "@/hooks/use-event-source";
import { useCachedJson } from "@/hooks/use-cached-json";
import { clientCacheInvalidate, clientCachePeek } from "@/lib/client/fetch-cache";
import type { TaskListItem } from "@/lib/services/tasks";
import { formatDateTime } from "@/lib/utils";

const selectTasks = (json: unknown) =>
  ((json as { tasks?: TaskListItem[] }).tasks || []) as TaskListItem[];

function placeholderTask(event: Record<string, unknown>): TaskListItem {
  return {
    id: String(event.taskId),
    taskNumber: String(event.taskNumber || "TASK-…"),
    taskType: "delayed_order_investigation",
    issueType: null,
    status: String(event.status || "running"),
    priority: "medium",
    requiresHumanApproval: false,
    triggerType: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    order: null,
    approvals: [],
  };
}

export function TasksClient({ initialTasks }: { initialTasks?: TaskListItem[] } = {}) {
  const {
    data: tasks = [],
    setData,
    error,
    loading,
    reload,
  } = useCachedJson("tasks:list", "/api/tasks", selectTasks, initialTasks);
  const [live, setLive] = useState("Live");

  const load = useCallback(() => {
    clientCacheInvalidate("tasks:");
    void reload();
  }, [reload]);

  useEventSource("/api/realtime/stream", (event) => {
    if (event.type === "connected") {
      setLive("Live");
      return;
    }
    if (event.type === "task_updated" && event.taskId) {
      setLive(`Live · ${new Date().toLocaleTimeString()}`);
      setData((prev) => {
        const list =
          prev ?? clientCachePeek<TaskListItem[]>("tasks:list") ?? [];
        const id = String(event.taskId);
        const idx = list.findIndex((t) => t.id === id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = {
            ...next[idx],
            status: String(event.status || next[idx].status),
            taskNumber: String(event.taskNumber || next[idx].taskNumber),
            requiresHumanApproval:
              event.status === "awaiting_approval" ? true : next[idx].requiresHumanApproval,
            approvals:
              event.status === "awaiting_approval"
                ? [{ status: "pending" }]
                : next[idx].approvals,
          };
          return next;
        }
        return [placeholderTask(event), ...list];
      });
      // Reconcile with server shortly after optimistic paint.
      window.setTimeout(() => load(), 250);
      return;
    }
    if (event.type === "trigger_processed" || event.type === "approval_requested" || event.type === "dashboard_changed") {
      setLive(`Live · ${new Date().toLocaleTimeString()}`);
      load();
    }
  });

  return (
    <AppShell
      title="Tasks & Investigations"
      description="Investigations started manually or by automatic triggers. Status updates in real time."
      actions={
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            {live}
          </span>
          <RunInvestigationButton />
        </div>
      }
    >
      <Card className="border-0">
        <CardContent className="pt-6">
          {error ? (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-4 text-center text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {loading && tasks.length === 0 ? (
            <TableSkeleton rows={7} cols={6} />
          ) : tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No investigations yet. Use <strong>Run Investigation</strong> or open{" "}
              <Link href="/triggers" className="text-blue-700 hover:underline">
                Triggers & Inbox
              </Link>
              .
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/tasks/${t.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {t.taskNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{t.order?.orderNumber || "—"}</TableCell>
                    <TableCell className="capitalize text-xs">
                      {(t.triggerType || "manual").replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="capitalize">
                      {(t.issueType || t.taskType).replaceAll("_", " ")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="capitalize">{t.priority}</TableCell>
                    <TableCell>
                      {t.approvals.some((a) => a.status === "pending") ||
                      t.status === "awaiting_approval"
                        ? "Pending"
                        : t.requiresHumanApproval
                          ? "Required"
                          : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDateTime(t.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
