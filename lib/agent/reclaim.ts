import { prisma, withPrismaRetry } from "@/lib/db/prisma";
import { publishRealtime } from "@/lib/realtime/events";
import { cacheInvalidate } from "@/lib/cache/memory";

/** Default: fail anything still running after 3 minutes. */
const DEFAULT_STALE_MS = 3 * 60 * 1000;

/**
 * Safety net: mark orphaned "running" tasks/executions as failed.
 * Covers DB drops, HMR killing after(), OpenAI hangs, pool timeouts.
 */
export async function reclaimStuckRunningTasks(staleMs = DEFAULT_STALE_MS) {
  const staleBefore = new Date(Date.now() - staleMs);

  const stuck = await withPrismaRetry(() =>
    prisma.agentTask.findMany({
      where: {
        status: "running",
        OR: [{ startedAt: { lt: staleBefore } }, { startedAt: null, createdAt: { lt: staleBefore } }],
      },
      select: { id: true, taskNumber: true },
      take: 50,
    }),
  );

  if (stuck.length === 0) {
    return { reclaimed: 0 };
  }

  const ids = stuck.map((t) => t.id);
  await withPrismaRetry(() =>
    prisma.agentTask.updateMany({
      where: { id: { in: ids }, status: "running" },
      data: {
        status: "failed",
        actionResult:
          "Automatically marked failed: investigation exceeded the safety timeout (DB/network interruption or hung model call). Start a new investigation.",
        completedAt: new Date(),
      },
    }),
  );
  await withPrismaRetry(() =>
    prisma.agentExecution.updateMany({
      where: { taskId: { in: ids }, status: "running" },
      data: {
        status: "failed",
        errorMessage: "Reclaimed stale running execution",
        completedAt: new Date(),
      },
    }),
  );

  for (const t of stuck) {
    publishRealtime({
      type: "task_updated",
      taskId: t.id,
      status: "failed",
      taskNumber: t.taskNumber,
    });
  }
  publishRealtime({ type: "dashboard_changed", reason: "tasks_reclaimed" });
  cacheInvalidate("tasks:");
  cacheInvalidate("dashboard:");

  console.warn(
    `[agent] reclaimed ${stuck.length} stuck running task(s):`,
    stuck.map((t) => t.taskNumber).join(", "),
  );

  return { reclaimed: stuck.length, taskNumbers: stuck.map((t) => t.taskNumber) };
}

/** Best-effort mark a single task failed (used from agent finally / catch). */
export async function forceFailTask(taskId: string, reason: string) {
  try {
    const task = await withPrismaRetry(() =>
      prisma.agentTask.findUnique({ where: { id: taskId }, select: { status: true, taskNumber: true } }),
    );
    if (!task || task.status !== "running") return false;

    await withPrismaRetry(() =>
      prisma.agentTask.update({
        where: { id: taskId },
        data: { status: "failed", actionResult: reason.slice(0, 2000), completedAt: new Date() },
      }),
    );
    await withPrismaRetry(() =>
      prisma.agentExecution.updateMany({
        where: { taskId, status: "running" },
        data: { status: "failed", errorMessage: reason.slice(0, 2000), completedAt: new Date() },
      }),
    );
    publishRealtime({
      type: "task_updated",
      taskId,
      status: "failed",
      taskNumber: task.taskNumber,
    });
    publishRealtime({ type: "dashboard_changed", reason: "task_failed" });
    cacheInvalidate("tasks:");
    return true;
  } catch (err) {
    console.error("[agent] forceFailTask failed:", err);
    return false;
  }
}
