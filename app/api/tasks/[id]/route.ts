import { jsonError, jsonOk } from "@/lib/api";
import { refreshTaskDetail } from "@/lib/services/task-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    // Always refresh — stale list/detail cache was hiding new HumanApproval rows
    // and leaving the Approvals tab disabled in the UI.
    const task = await refreshTaskDetail(id);
    if (!task) return jsonError("Task not found", 404);
    return jsonOk({ task });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load task", 500);
  }
}
