import { jsonError, jsonOk } from "@/lib/api";
import { getOrdersList } from "@/lib/services/lists";
import { prisma } from "@/lib/db/prisma";
import { cacheGet, cacheSet } from "@/lib/cache/memory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q) return jsonOk(await getOrdersList());

    const cacheKey = `orders:list:${q}`;
    const cached = cacheGet<{ orders: unknown[] }>(cacheKey);
    if (cached) return jsonOk(cached);

    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { orderNumber: { contains: q } },
          { customer: { name: { contains: q } } },
          { customer: { email: { contains: q } } },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        orderStatus: true,
        productionStatus: true,
        shippingStatus: true,
        trackingNumber: true,
        orderValue: true,
        issueType: true,
        expectedDeliveryDate: true,
        orderDate: true,
        customer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { orderDate: "desc" },
      take: 100,
    });
    const payload = JSON.parse(JSON.stringify({ orders }));
    cacheSet(cacheKey, payload, 5000);
    return jsonOk(payload);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load orders", 500);
  }
}
