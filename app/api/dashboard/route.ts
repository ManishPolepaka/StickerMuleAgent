import { getDashboardMetrics, refreshDashboardMetrics } from "@/lib/services/metrics";
import { jsonError, jsonOk } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache/memory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    if (fresh) {
      cacheInvalidate("dashboard:");
      return jsonOk(await refreshDashboardMetrics());
    }
    const metrics = await getDashboardMetrics();
    return jsonOk(metrics);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load metrics", 500);
  }
}
