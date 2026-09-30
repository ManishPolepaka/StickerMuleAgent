import { prisma } from "@/lib/db/prisma";
import { createKeyedSwrLoader } from "@/lib/cache/swr";
import { cacheSet } from "@/lib/cache/memory";

async function loadOrderDetail(id: string) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNumber: id }] },
    include: {
      customer: true,
      productionRecords: true,
      shipmentEvents: { orderBy: { eventAt: "desc" } },
      supportTickets: true,
      tasks: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!order) return null;
  const normalized = JSON.parse(JSON.stringify(order));
  cacheSet(`orders:detail:${normalized.id}`, normalized, 10_000);
  cacheSet(`orders:detail:${normalized.orderNumber}`, normalized, 10_000);
  return normalized;
}

const loader = createKeyedSwrLoader((id) => `orders:detail:${id}`, loadOrderDetail, 10_000);

export async function getOrderDetail(id: string) {
  return loader.get(id);
}
