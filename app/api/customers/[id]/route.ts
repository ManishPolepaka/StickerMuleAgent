import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const customer = await prisma.customer.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
      include: {
        orders: { orderBy: { orderDate: "desc" } },
        supportHistory: { orderBy: { createdAt: "desc" } },
        supportTickets: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!customer) return jsonError("Customer not found", 404);
    return jsonOk({ customer });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load customer", 500);
  }
}
