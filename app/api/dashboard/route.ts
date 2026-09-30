import { getDashboardMetrics } from "@/lib/services/metrics";
import { jsonError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const metrics = await getDashboardMetrics();
    return jsonOk(metrics);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load metrics", 500);
  }
}
