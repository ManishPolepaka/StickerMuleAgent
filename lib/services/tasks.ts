import { prisma } from "@/lib/db/prisma";
import { cacheGetStale, cacheSet } from "@/lib/cache/memory";

export type TaskListItem = {
  id: string;
  taskNumber: string;
  taskType: string;
  issueType: string | null;
  status: string;
  priority: string;
  requiresHumanApproval: boolean;
  triggerType: string | null;
  createdAt: string;
  completedAt: string | null;
  order: { orderNumber: string } | null;
  approvals: Array<{ status: string }>;
};

export type TasksListPayload = { tasks: TaskListItem[] };

const CACHE_KEY = "tasks:list";
const TTL_MS = 60_000;

let refreshInFlight: Promise<TasksListPayload> | null = null;

async function fetchTasksList(): Promise<TasksListPayload> {
  const tasks = await prisma.agentTask.findMany({
    select: {
      id: true,
      taskNumber: true,
      taskType: true,
      issueType: true,
      status: true,
      priority: true,
      requiresHumanApproval: true,
      triggerType: true,
      createdAt: true,
      completedAt: true,
      order: { select: { orderNumber: true } },
      approvals: {
        where: { status: "pending" },
        select: { status: true },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    tasks: tasks.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    })),
  };
}

export async function refreshTasksList(): Promise<TasksListPayload> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = fetchTasksList()
    .then((payload) => {
      cacheSet(CACHE_KEY, payload, TTL_MS);
      return payload;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Instant when warm: stale-while-revalidate for Tasks & Investigations. */
export async function getTasksList(): Promise<TasksListPayload> {
  const hit = cacheGetStale<TasksListPayload>(CACHE_KEY);
  if (hit?.fresh) return hit.value;
  if (hit && !hit.fresh) {
    void refreshTasksList().catch(() => undefined);
    return hit.value;
  }
  return refreshTasksList();
}

export async function warmTasksList(): Promise<void> {
  await refreshTasksList();
}
