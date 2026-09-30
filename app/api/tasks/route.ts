import { z } from "zod";
import { startInvestigation } from "@/lib/agent/runtime";
import { jsonError, jsonOk, parseJson } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache/memory";
import { getTasksList, warmTasksList } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  orderId: z.string().optional().nullable(),
  prompt: z.string().min(8),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export async function GET() {
  try {
    // Force a fresh DB read so newly started agents appear immediately.
    cacheInvalidate("tasks:");
    await warmTasksList();
    return jsonOk(await getTasksList());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load tasks", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await parseJson(request));
    const task = await startInvestigation({
      orderId: body.orderId,
      prompt: body.prompt,
      priority: body.priority,
    });
    cacheInvalidate("tasks:");
    cacheInvalidate("dashboard:");
    return jsonOk({ task }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to start investigation", 400);
  }
}
