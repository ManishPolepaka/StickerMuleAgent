import { jsonError, jsonOk } from "@/lib/api";
import { getOrderDetail } from "@/lib/services/order-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const order = await getOrderDetail(id);
    if (!order) return jsonError("Order not found", 404);
    return jsonOk({ order });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load order", 500);
  }
}
