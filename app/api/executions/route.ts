import { jsonError, jsonOk } from "@/lib/api";
import { getExecutionsList } from "@/lib/services/lists";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk(await getExecutionsList());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load executions", 500);
  }
}
