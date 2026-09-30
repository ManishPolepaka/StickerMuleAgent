import { sseResponse } from "@/lib/realtime/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Global stream for dashboard, tasks list, and triggers page. */
export async function GET() {
  return sseResponse({
    channel: "global",
    filter: (event) =>
      event.type === "task_updated" ||
      event.type === "dashboard_changed" ||
      event.type === "trigger_processed" ||
      event.type === "routing_started" ||
      event.type === "approval_requested",
  });
}
