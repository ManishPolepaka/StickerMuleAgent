import { jsonError, jsonOk } from "@/lib/api";
import { getCustomersList } from "@/lib/services/lists";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk(await getCustomersList());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load customers", 500);
  }
}
