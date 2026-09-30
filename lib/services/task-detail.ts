import { prisma } from "@/lib/db/prisma";
import { createKeyedSwrLoader } from "@/lib/cache/swr";
import { ensurePendingApproval } from "@/lib/agent/ensure-approval";

async function loadTaskDetail(id: string) {
  let task = await prisma.agentTask.findFirst({
    where: { OR: [{ id }, { taskNumber: id }] },
    include: {
      order: {
        include: {
          customer: true,
          supportTickets: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      },
      approvals: { orderBy: { createdAt: "desc" } },
      emails: { orderBy: { createdAt: "desc" } },
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { steps: { orderBy: { stepIndex: "asc" } } },
      },
    },
  });
  if (!task) return null;

  // Backfill missing approval rows so the Case panel always has Approve/Reject.
  if (
    (task.status === "awaiting_approval" || task.requiresHumanApproval) &&
    task.approvals.length === 0
  ) {
    await ensurePendingApproval(task.id);
    task = await prisma.agentTask.findFirst({
      where: { id: task.id },
      include: {
        order: {
          include: {
            customer: true,
            supportTickets: { orderBy: { createdAt: "desc" }, take: 10 },
          },
        },
        approvals: { orderBy: { createdAt: "desc" } },
        emails: { orderBy: { createdAt: "desc" } },
        executions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { steps: { orderBy: { stepIndex: "asc" } } },
        },
      },
    });
    if (!task) return null;
  }

  // Normalize dates to ISO strings for stable SSR/client hydration.
  const normalized = JSON.parse(JSON.stringify(task)) as typeof task;
  const { cacheSet } = await import("@/lib/cache/memory");
  cacheSet(`tasks:detail:${normalized.id}`, normalized, 10_000);
  cacheSet(`tasks:detail:${normalized.taskNumber}`, normalized, 10_000);
  return normalized;
}

const loader = createKeyedSwrLoader(
  (id) => `tasks:detail:${id}`,
  loadTaskDetail,
  10_000,
);

export async function getTaskDetail(id: string) {
  return loader.get(id);
}

export async function refreshTaskDetail(id: string) {
  return loader.refresh(id);
}
