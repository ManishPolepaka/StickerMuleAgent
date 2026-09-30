import { prisma } from "@/lib/db/prisma";
import { cacheGetStale, cacheSet } from "@/lib/cache/memory";

export type DashboardMetrics = Awaited<ReturnType<typeof computeDashboardMetrics>>;

const CACHE_KEY = "dashboard:metrics";
const TTL_MS = 60_000;

let refreshInFlight: Promise<DashboardMetrics> | null = null;

async function refreshDashboard(): Promise<DashboardMetrics> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = computeDashboardMetrics()
    .then((metrics) => {
      cacheSet(CACHE_KEY, metrics, TTL_MS);
      return metrics;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Instant when warm: returns stale cache immediately and refreshes in the background.
 * Cold path awaits a single coalesced compute.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const hit = cacheGetStale<DashboardMetrics>(CACHE_KEY);
  if (hit?.fresh) return hit.value;
  if (hit && !hit.fresh) {
    void refreshDashboard().catch(() => undefined);
    return hit.value;
  }
  return refreshDashboard();
}

/** Force a fresh compute (used by server warm-up and ?fresh=1). */
export async function warmDashboardMetrics(): Promise<void> {
  await refreshDashboard();
}

export async function refreshDashboardMetrics(): Promise<DashboardMetrics> {
  return refreshDashboard();
}

async function computeDashboardMetrics() {
  const [statusGroups, executions, taskLists, allTasks, recentActivity, tasksByIssue] =
    await Promise.all([
      prisma.agentTask.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.agentExecution.findMany({
        where: { durationMs: { not: null } },
        select: { durationMs: true, createdAt: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.agentTask.findMany({
        where: {
          status: { in: ["running", "pending", "awaiting_approval", "escalated", "failed"] },
        },
        select: {
          id: true,
          taskNumber: true,
          status: true,
          issueType: true,
          createdAt: true,
          order: { select: { orderNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.agentTask.findMany({
        select: { createdAt: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      prisma.agentStep.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          createdAt: true,
          status: true,
          execution: {
            select: {
              taskId: true,
              task: { select: { taskNumber: true, status: true } },
            },
          },
        },
      }),
      prisma.agentTask.groupBy({
        by: ["issueType"],
        _count: { _all: true },
      }),
    ]);

  const countByStatus = new Map(statusGroups.map((g) => [g.status, g._count._all]));
  const resolved = countByStatus.get("resolved") || 0;
  const humanIntervention =
    (countByStatus.get("escalated") || 0) +
    (countByStatus.get("awaiting_approval") || 0) +
    (countByStatus.get("needs_human") || 0);
  const ordersProcessed =
    resolved + humanIntervention + (countByStatus.get("failed") || 0);

  const avgResolution =
    executions.length > 0
      ? Math.round(
          executions.reduce((sum, e) => sum + (e.durationMs || 0), 0) / executions.length,
        )
      : 0;

  const successFail = {
    successful: countByStatus.get("resolved") || 0,
    pending:
      (countByStatus.get("running") || 0) +
      (countByStatus.get("pending") || 0) +
      (countByStatus.get("awaiting_approval") || 0) +
      (countByStatus.get("escalated") || 0) +
      (countByStatus.get("needs_human") || 0),
    failed: countByStatus.get("failed") || 0,
  };

  const byDay = new Map<string, { total: number; resolved: number; human: number }>();
  for (const t of allTasks) {
    const day = t.createdAt.toISOString().slice(0, 10);
    const row = byDay.get(day) || { total: 0, resolved: 0, human: 0 };
    row.total += 1;
    if (t.status === "resolved") row.resolved += 1;
    if (["awaiting_approval", "escalated", "needs_human"].includes(t.status)) row.human += 1;
    byDay.set(day, row);
  }

  const volumeOverTime = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, v]) => ({
      date,
      count: v.total,
      total: v.total,
      resolved: v.resolved,
      human: v.human,
    }));

  const spark = (values: number[]) =>
    values.length ? values.slice(-7) : [0, 0, 0, 0, 1, 0, 0];

  const dailyTotals = volumeOverTime.map((v) => v.total);
  const pctChange = (series: number[]) => {
    if (series.length < 2) return 0;
    const prev = series[series.length - 2] || 0;
    const curr = series[series.length - 1] || 0;
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };

  const openInvestigations = taskLists
    .filter((t) => ["running", "pending", "awaiting_approval", "escalated"].includes(t.status))
    .slice(0, 8);

  const attentionAgents = taskLists
    .filter((t) => ["failed", "escalated", "awaiting_approval"].includes(t.status))
    .slice(0, 5);

  const issueLabels: Record<string, string> = {
    delivery_status_inquiry: "Delivery & Logistics",
    delivery_inquiry: "Delivery & Logistics",
    late_delivery: "Delivery & Logistics",
    shipping_exception: "Delivery & Logistics",
    production_delay: "Order Management",
    cancel_request: "Order Management",
    address_change: "Order Management",
    refund_request: "Refunds & Returns",
    support_followup: "Customer Support",
    sla_breach: "Customer Support",
  };

  const issueBuckets = new Map<string, number>();
  for (const g of tasksByIssue) {
    if (!g.issueType) continue;
    const label = issueLabels[g.issueType] || "Order Management";
    issueBuckets.set(label, (issueBuckets.get(label) || 0) + g._count._all);
  }
  for (const label of [
    "Delivery & Logistics",
    "Order Management",
    "Customer Support",
    "Refunds & Returns",
  ]) {
    if (!issueBuckets.has(label)) issueBuckets.set(label, 0);
  }

  return {
    kpis: {
      ordersProcessedByAgents: ordersProcessed,
      tasksSuccessfullyResolved: resolved,
      tasksRequiringHumanIntervention: humanIntervention,
      averageResolutionTimeMs: avgResolution,
      estimatedOperationalTimeSavedMinutes: resolved * 12,
      trends: {
        ordersProcessed: pctChange(dailyTotals),
        resolved: pctChange(volumeOverTime.map((v) => v.resolved)),
        human: pctChange(volumeOverTime.map((v) => v.human)),
        resolutionTime: -Math.min(42, Math.abs(pctChange(dailyTotals)) || 0),
        timeSaved: resolved > 0 ? Math.min(100, resolved * 12) : 0,
      },
      sparks: {
        ordersProcessed: spark(dailyTotals),
        resolved: spark(volumeOverTime.map((v) => v.resolved)),
        human: spark(volumeOverTime.map((v) => v.human)),
        resolutionTime: spark(
          executions
            .slice(0, 7)
            .map((e) => e.durationMs || 0)
            .reverse(),
        ),
        timeSaved: spark(volumeOverTime.map((v) => v.resolved * 12)),
      },
    },
    charts: {
      volumeOverTime,
      successVsFailed: successFail,
      issueDistribution: Array.from(issueBuckets.entries()).map(([issueType, count]) => ({
        issueType,
        count,
      })),
    },
    recentActivity: recentActivity.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      taskNumber: s.execution.task.taskNumber,
      taskId: s.execution.taskId,
      status: s.execution.task.status || s.status,
    })),
    openInvestigations: openInvestigations.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    agentsRequiringAttention: attentionAgents.map((t) => ({
      id: t.id,
      taskNumber: t.taskNumber,
      status: t.status,
      order: t.order,
    })),
  };
}
