import { z } from "zod";
import { jsonError, jsonOk, parseJson } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache/memory";
import { publishRealtime } from "@/lib/realtime/events";

export const dynamic = "force-dynamic";

/**
 * Called by the Go worker so Next.js SSE clients stay in sync.
 * Go writes to Supabase directly; without this, overview/list/detail
 * never hear about Running → Resolved (or new steps).
 */
const schema = z.object({
  type: z.enum(["task_updated", "step_added", "dashboard_changed"]),
  taskId: z.string().min(1),
  taskNumber: z.string().optional(),
  status: z.string().optional(),
  executionId: z.string().optional(),
  step: z
    .object({
      id: z.string(),
      stepIndex: z.number(),
      stepType: z.string(),
      title: z.string(),
      detail: z.string().nullable().optional(),
      toolName: z.string().nullable().optional(),
      toolInputJson: z.string().nullable().optional(),
      toolResultJson: z.string().nullable().optional(),
      status: z.string(),
      createdAt: z.string(),
    })
    .optional(),
  reason: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await parseJson(request));

    if (body.type === "step_added" && body.step && body.executionId) {
      publishRealtime({
        type: "step_added",
        taskId: body.taskId,
        executionId: body.executionId,
        step: {
          id: body.step.id,
          stepIndex: body.step.stepIndex,
          stepType: body.step.stepType,
          title: body.step.title,
          detail: body.step.detail ?? null,
          toolName: body.step.toolName ?? null,
          toolInputJson: body.step.toolInputJson ?? null,
          toolResultJson: body.step.toolResultJson ?? null,
          status: body.step.status,
          createdAt: body.step.createdAt,
        },
      });
    } else if (body.type === "task_updated") {
      publishRealtime({
        type: "task_updated",
        taskId: body.taskId,
        status: body.status || "running",
        taskNumber: body.taskNumber,
      });
      publishRealtime({
        type: "dashboard_changed",
        reason: body.reason || `task_${body.status || "updated"}`,
      });
    } else if (body.type === "dashboard_changed") {
      publishRealtime({
        type: "dashboard_changed",
        reason: body.reason || "worker_event",
      });
    }

    cacheInvalidate("tasks:");
    cacheInvalidate("dashboard:");

    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Invalid worker event", 400);
  }
}
