"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatDuration, formatTime } from "@/lib/utils";
import { useEventSource } from "@/hooks/use-event-source";
import {
  collapseTimelineSteps,
  extractCreatedTickets,
  extractDraftEmail,
  humanizeSummary,
} from "@/lib/ui/task-presentation";
import { clientCachePeek, clientCacheSet } from "@/lib/client/fetch-cache";
import { fetchJson } from "@/lib/client/fetch-json";
import { agentDebug, agentDebugWarn } from "@/lib/client/agent-debug";
import { useClientCacheSnapshot } from "@/hooks/use-cached-json";
import { TableSkeleton } from "@/components/ui/table-skeleton";

type Step = {
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

type SupportTicket = {
  id: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  createdBy: string;
  createdAt: string;
};

export type TaskDetail = {
  id: string;
  taskNumber: string;
  prompt: string;
  status: string;
  requiresHumanApproval?: boolean;
  investigationSummary: string | null;
  reasoningSummary: string | null;
  selectedAction: string | null;
  actionResult: string | null;
  finalResultJson: string | null;
  order: {
    orderNumber: string;
    customer: { name: string; email: string };
    supportTickets: SupportTicket[];
  } | null;
  approvals: Array<{
    id: string;
    proposedAction: string;
    reason: string;
    status: string;
    evidenceJson: string | null;
    reviewerComment: string | null;
  }>;
  emails: Array<{
    id: string;
    subject: string;
    toEmail: string;
    body?: string;
    status: string;
    provider: string;
  }>;
  executions: Array<{
    id: string;
    modelProvider: string;
    modelName: string;
    status: string;
    durationMs: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    steps: Step[];
  }>;
};

export function TaskDetailClient({
  taskId,
  initialTask,
}: {
  taskId: string;
  initialTask?: TaskDetail;
}) {
  const cacheKey = `task:${taskId}`;
  const cachedTask = useClientCacheSnapshot<TaskDetail>(cacheKey);
  const [task, setTask] = useState<TaskDetail | null>(initialTask ?? null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [openTech, setOpenTech] = useState<Record<string, boolean>>({});
  const [leftTab, setLeftTab] = useState<"timeline" | "reply" | "tickets">("timeline");
  const [rightTab, setRightTab] = useState<"details" | "approvals" | "outcome">("details");
  const [loadError, setLoadError] = useState<string | null>(null);
  const userPickedRightTab = useRef(false);

  useEffect(() => {
    if (initialTask) {
      clientCacheSet(cacheKey, initialTask);
      setTask(initialTask);
    }
  }, [initialTask, cacheKey]);

  useEffect(() => {
    if (!task && cachedTask) setTask(cachedTask);
  }, [task, cachedTask]);

  useEffect(() => {
    let alive = true;
    agentDebug("task-detail", `loading ${taskId}`);
    fetchJson<{ task: TaskDetail }>(`/api/tasks/${taskId}`, { retries: 3 })
      .then((d) => {
        if (!alive) return;
        agentDebug("task-detail", "loaded", {
          taskNumber: d.task?.taskNumber,
          status: d.task?.status,
          steps: d.task?.executions?.[0]?.steps?.length ?? 0,
          execStatus: d.task?.executions?.[0]?.status,
        });
        clientCacheSet(cacheKey, d.task);
        setTask(d.task);
        setLoadError(null);
      })
      .catch((e) => {
        if (!alive) return;
        agentDebugWarn("task-detail", "load failed", e);
        // Don't wipe a good cached task with a transient Fast Refresh 404.
        if (cachedTask || task) {
          setLoadError(null);
          return;
        }
        setLoadError(e instanceof Error ? e.message : "Failed to load task");
      });
    return () => {
      alive = false;
    };
  }, [taskId, cacheKey]);

  useEventSource(`/api/realtime/tasks/${taskId}`, (event) => {
    if (event.type === "step_added" && event.step) {
      const step = event.step as Step;
      agentDebug("task-detail", "step_added", {
        title: step.title,
        toolName: step.toolName,
        status: step.status,
        stepIndex: step.stepIndex,
      });
      setTask((prev) => {
        if (!prev) return prev;
        const executions = [...prev.executions];
        if (!executions[0]) {
          executions[0] = {
            id: String(event.executionId || "live"),
            modelProvider: "—",
            modelName: "—",
            status: "running",
            durationMs: null,
            totalTokens: null,
            estimatedCostUsd: null,
            steps: [step],
          };
        } else {
          const exists = executions[0].steps.some((s) => s.id === step.id);
          if (!exists) {
            executions[0] = {
              ...executions[0],
              steps: [...executions[0].steps, step],
            };
          }
        }
        return { ...prev, executions };
      });
    }
    if (event.type === "task_updated" || event.type === "approval_requested") {
      agentDebug("task-detail", String(event.type), event);
      fetchJson<{ task?: TaskDetail }>(`/api/tasks/${taskId}`, { retries: 2 })
        .then((data) => {
          if (data.task) {
            agentDebug("task-detail", "refreshed after event", {
              status: data.task.status,
              steps: data.task.executions?.[0]?.steps?.length ?? 0,
            });
            setTask(data.task);
            clientCacheSet(cacheKey, data.task);
          }
        })
        .catch((err) => agentDebugWarn("task-detail", "refresh after event failed", err));
    }
  });

  // Keep detail in sync while Running — Go worker writes DB directly; SSE can miss events.
  useEffect(() => {
    if (task?.status !== "running") return;
    agentDebug("task-detail", "start running poll", {
      taskNumber: task.taskNumber,
      steps: task.executions?.[0]?.steps?.length ?? 0,
    });
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      fetchJson<{ task?: TaskDetail }>(`/api/tasks/${taskId}`, { retries: 2 })
        .then((data) => {
          if (!data.task) return;
          const stepsCount = data.task.executions?.[0]?.steps?.length ?? 0;
          const lastStep = data.task.executions?.[0]?.steps?.[stepsCount - 1];
          agentDebug("task-detail", `poll ${elapsedSec}s`, {
            status: data.task.status,
            execStatus: data.task.executions?.[0]?.status,
            steps: stepsCount,
            lastStep: lastStep
              ? `${lastStep.stepType}:${lastStep.toolName || lastStep.title}`
              : null,
          });
          if (data.task.status === "running" && stepsCount === 0 && elapsedSec >= 15) {
            agentDebugWarn(
              "task-detail",
              "still running with 0 steps after 15s — agent loop may be hung (DB pool / after() / model)",
            );
          }
          setTask(data.task);
          clientCacheSet(cacheKey, data.task);
          // Keep tasks list badge in sync when this tab observes a terminal status.
          if (data.task.status !== "running") {
            const list = clientCachePeek<Array<{ id: string; status: string }>>("tasks:list");
            if (list) {
              clientCacheSet(
                "tasks:list",
                list.map((t) =>
                  t.id === data.task!.id ? { ...t, status: data.task!.status } : t,
                ),
              );
            }
          }
        })
        .catch((err) => agentDebugWarn("task-detail", "poll failed", err));
    }, 2000);
    return () => window.clearInterval(id);
  }, [task?.status, task?.taskNumber, taskId, cacheKey]);

  // Keep session cache in sync after local task state settles (never inside setState).
  useEffect(() => {
    if (task) clientCacheSet(cacheKey, task);
  }, [task, cacheKey]);

  async function review(approvalId: string, decision: "approved" | "rejected") {
    setBusy(true);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, decision, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Action ${decision}`);
      const refreshed = await fetch(`/api/tasks/${taskId}`).then((r) => r.json());
      if (refreshed.task) {
        setTask(refreshed.task);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  const execution = task?.executions?.[0];
  const steps = execution?.steps || [];
  const timeline = useMemo(() => collapseTimelineSteps(steps), [steps]);
  const draft = useMemo(() => extractDraftEmail(steps), [steps]);
  const ticketsFromTools = useMemo(() => extractCreatedTickets(steps), [steps]);
  const finalParsed = useMemo(() => {
    if (!task?.finalResultJson) return null;
    try {
      return JSON.parse(task.finalResultJson) as {
        problemIdentified?: string;
        rootCause?: string | null;
        proposedOrCompletedAction?: string;
        remainingRisks?: string[];
      };
    } catch {
      return null;
    }
  }, [task?.finalResultJson]);

  const pendingApprovalCount = (task?.approvals || []).filter(
    (a) => a.status === "pending",
  ).length;

  // Open Approvals automatically when human review is waiting.
  useEffect(() => {
    if (userPickedRightTab.current) return;
    if (
      pendingApprovalCount > 0 ||
      task?.status === "awaiting_approval" ||
      task?.requiresHumanApproval
    ) {
      setRightTab("approvals");
    }
  }, [pendingApprovalCount, task?.status, task?.requiresHumanApproval]);

  if (!task) {
    return (
      <AppShell>
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">Task</span>
        </div>
        {loadError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </div>
        ) : (
          <TableSkeleton rows={10} cols={3} />
        )}
      </AppShell>
    );
  }

  const agentTickets = (task.order?.supportTickets || []).filter(
    (t) =>
      t.createdBy === "order_operations_agent" ||
      ticketsFromTools.some((x) => x.ticketId === t.id),
  );

  const hasReply = Boolean(draft || (task.emails?.length ?? 0) > 0);
  const hasTickets = agentTickets.length > 0;
  const pendingApprovals = (task.approvals || []).filter((a) => a.status === "pending");
  const hasApprovals = (task.approvals || []).length > 0;
  const hasOutcome = Boolean(finalParsed);

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{task.taskNumber}</span>
          <StatusBadge status={task.status} />
        </div>
        {execution ? (
          <Link href={`/logs/${execution.id}`} className="text-sm text-blue-700 hover:underline">
            Open full technical log
          </Link>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-0 xl:col-span-2">
          <CardHeader className="space-y-3 pb-0">
            <div>
              <CardTitle className="text-base font-semibold">Investigation</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                What the agent did, customer updates, and tickets from this run.
              </p>
            </div>
            <CardTabRow
              tabs={[
                { id: "timeline", label: "Timeline" },
                { id: "reply", label: "Customer reply", disabled: !hasReply },
                { id: "tickets", label: "Tickets", disabled: !hasTickets, count: agentTickets.length },
              ]}
              value={leftTab}
              onChange={(id) => setLeftTab(id as typeof leftTab)}
            />
          </CardHeader>
          <CardContent className="pt-4">
            {leftTab === "timeline" ? (
              timeline.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Waiting for agent steps… history is saved and will appear here.
                </p>
              ) : (
                <ol className="relative ml-3 space-y-0 border-l border-slate-200">
                  {timeline.map((s) => {
                    const hasTech = Boolean(s.toolInputJson || s.toolResultJson);
                    const open = openTech[s.id];
                    return (
                      <li key={s.id} className="relative pb-5 pl-6">
                        <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-white bg-blue-600 shadow" />
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-slate-900">{s.title}</div>
                            <p className="mt-1 text-sm text-slate-600">{s.plainEnglish}</p>
                          </div>
                          <span className="shrink-0 text-[11px] text-slate-400">
                            {formatTime(s.createdAt)}
                          </span>
                        </div>
                        {hasTech ? (
                          <button
                            type="button"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                            onClick={() =>
                              setOpenTech((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                            }
                          >
                            {open ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            {open ? "Hide technical details" : "View technical details"}
                          </button>
                        ) : null}
                        {open && hasTech ? (
                          <div className="mt-2 space-y-2">
                            {s.toolInputJson ? (
                              <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                                in: {s.toolInputJson}
                              </pre>
                            ) : null}
                            {s.toolResultJson ? (
                              <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                                out: {s.toolResultJson}
                              </pre>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )
            ) : null}

            {leftTab === "reply" ? (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-slate-500">
                  What would go to the customer — separate from the internal summary.
                  {(task.emails?.length ?? 0) > 0
                    ? " Simulated send is shown below."
                    : draft
                      ? " Draft only (not sent)."
                      : ""}
                </p>
                {(task.emails || []).map((e) => (
                  <div key={e.id} className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                    <div className="text-xs font-medium text-amber-800">
                      Simulated send · {e.provider} · {e.status}
                    </div>
                    <div className="mt-1 font-medium">{e.subject}</div>
                    <div className="text-xs text-slate-500">{e.toEmail}</div>
                    {e.body ? (
                      <div className="mt-3 whitespace-pre-wrap text-slate-700">{e.body}</div>
                    ) : null}
                  </div>
                ))}
                {draft && (task.emails?.length ?? 0) === 0 ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-400">To</div>
                    <div>{draft.to || task.order?.customer.email}</div>
                    <div className="mt-2 text-xs uppercase tracking-wide text-slate-400">
                      Subject
                    </div>
                    <div className="font-medium">{draft.subject}</div>
                    <div className="mt-3 whitespace-pre-wrap text-slate-700">{draft.body}</div>
                  </div>
                ) : null}
                {draft && (task.emails?.length ?? 0) > 0 ? (
                  <details className="rounded-xl border border-slate-100 bg-white p-3">
                    <summary className="cursor-pointer text-xs font-medium text-slate-500">
                      Earlier draft (not used for send)
                    </summary>
                    <div className="mt-2 font-medium">{draft.subject}</div>
                    <div className="mt-2 whitespace-pre-wrap text-slate-700">{draft.body}</div>
                  </details>
                ) : null}
                {!hasReply ? (
                  <p className="text-sm text-slate-500">No customer reply drafted yet.</p>
                ) : null}
              </div>
            ) : null}

            {leftTab === "tickets" ? (
              <div className="space-y-3">
                {agentTickets.map((t) => (
                  <div key={t.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={t.status} />
                      <span className="capitalize text-slate-700">
                        {t.category.replaceAll("_", " ")}
                      </span>
                      <span className="text-xs uppercase text-slate-400">{t.priority}</span>
                    </div>
                    <p className="mt-2 text-slate-700">{t.description}</p>
                    <div className="mt-2 text-[11px] text-slate-400">
                      ID {t.id} · by {t.createdBy} · {formatDateTime(t.createdAt)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <Link href={`/tickets/${t.id}`} className="text-blue-700 hover:underline">
                        Open ticket
                      </Link>
                      {task.order ? (
                        <Link
                          href={`/orders/${task.order.orderNumber}`}
                          className="text-blue-700 hover:underline"
                        >
                          View order {task.order.orderNumber}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!hasTickets ? (
                  <p className="text-sm text-slate-500">No support tickets created in this run.</p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-0">
          <CardHeader className="space-y-3 pb-0">
            <CardTitle className="text-base font-semibold">Case panel</CardTitle>
            <CardTabRow
              tabs={[
                { id: "details", label: "Details" },
                {
                  id: "approvals",
                  label: "Approvals",
                  disabled: false,
                  count: pendingApprovals.length || (hasApprovals ? task.approvals.length : undefined),
                },
                { id: "outcome", label: "Outcome", disabled: !hasOutcome },
              ]}
              value={rightTab}
              onChange={(id) => {
                userPickedRightTab.current = true;
                setRightTab(id as typeof rightTab);
              }}
            />
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            {rightTab === "details" ? (
              <>
                <Row label="Order" value={task.order?.orderNumber || "—"} />
                <Row label="Customer" value={task.order?.customer.name || "—"} />
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Summary</div>
                  <p className="mt-1 leading-relaxed text-slate-800">
                    {humanizeSummary(
                      finalParsed?.problemIdentified
                        ? `${finalParsed.problemIdentified}. ${
                            finalParsed.rootCause ? `Root cause: ${finalParsed.rootCause}. ` : ""
                          }${task.investigationSummary || ""}`
                        : task.investigationSummary,
                    )}
                  </p>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Action</div>
                  <p className="mt-1 text-slate-800">
                    {task.selectedAction || finalParsed?.proposedOrCompletedAction || "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {ticketsFromTools.length > 0
                      ? `Includes ${ticketsFromTools.length} support ticket(s) saved in the database.`
                      : "No support ticket was created in this run."}
                    {draft
                      ? " Customer email was drafted (not automatically emailed unless send tool ran)."
                      : ""}
                  </p>
                </div>
                <Row
                  label="Model"
                  value={execution ? `${execution.modelProvider} / ${execution.modelName}` : "—"}
                />
                <Row label="Duration" value={formatDuration(execution?.durationMs)} />
                <Row
                  label="Tokens"
                  value={
                    execution?.totalTokens != null
                      ? `${execution.totalTokens} (est. $${(execution.estimatedCostUsd || 0).toFixed(5)})`
                      : "—"
                  }
                />
              </>
            ) : null}

            {rightTab === "approvals" ? (
              hasApprovals ? (
                <div className="space-y-4">
                  {(task.approvals || []).map((a) => (
                    <div
                      key={a.id}
                      className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3"
                    >
                      <Row label="Proposed" value={a.proposedAction} />
                      <Row label="Reason" value={a.reason} />
                      <Row label="Status" value={a.status} />
                      {a.status === "pending" ? (
                        <>
                          <Textarea
                            placeholder="Add a reviewer comment"
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button
                              disabled={busy}
                              className="bg-blue-600 text-white hover:bg-blue-700"
                              onClick={() => review(a.id, "approved")}
                            >
                              Approve
                            </Button>
                            <Button
                              disabled={busy}
                              variant="destructive"
                              onClick={() => review(a.id, "rejected")}
                            >
                              Reject
                            </Button>
                          </div>
                          <p className="text-xs text-slate-500">
                            Demo note: approval records the decision only — no real refunds or
                            financial transactions are executed.
                          </p>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No approvals requested for this task.</p>
              )
            ) : null}

            {rightTab === "outcome" ? (
              finalParsed ? (
                <div className="space-y-2">
                  <Row label="Problem" value={finalParsed.problemIdentified || "—"} />
                  <Row label="Root cause" value={finalParsed.rootCause || "Not confirmed"} />
                  <Row label="Next / done" value={finalParsed.proposedOrCompletedAction || "—"} />
                  {(finalParsed.remainingRisks || []).length > 0 ? (
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-400">Risks</div>
                      <ul className="mt-1 list-disc pl-4 text-slate-700">
                        {finalParsed.remainingRisks!.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Outcome snapshot is not available yet.</p>
              )
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function CardTabRow({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; disabled?: boolean; count?: number }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active
                ? "bg-white text-slate-900 shadow-sm"
                : tab.disabled
                  ? "cursor-not-allowed text-slate-400"
                  : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? "bg-blue-50 text-blue-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}
