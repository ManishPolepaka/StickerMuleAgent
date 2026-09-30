import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache/memory";
import { getTicketsList } from "@/lib/services/lists";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const createdBy = searchParams.get("createdBy");
    const q = searchParams.get("q");

    const isDefault =
      (!status || status === "all" || status === "open") &&
      (!priority || priority === "all") &&
      (!createdBy || createdBy === "all") &&
      !q;

    // Default tickets page filter is often status=open — still use dedicated query with cache.
    if (!status && !priority && !createdBy && !q) {
      return jsonOk(await getTicketsList());
    }

    const cacheKey = `tickets:list:${status || "all"}:${priority || "all"}:${createdBy || "all"}:${q || ""}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return jsonOk(cached);

    const tickets = await prisma.supportTicket.findMany({
      where: {
        ...(status && status !== "all" ? { status } : {}),
        ...(priority && priority !== "all" ? { priority } : {}),
        ...(createdBy === "agent"
          ? { createdBy: "order_operations_agent" }
          : createdBy === "human"
            ? { NOT: { createdBy: "order_operations_agent" } }
            : {}),
        ...(q
          ? {
              OR: [
                { description: { contains: q } },
                { category: { contains: q } },
                { order: { orderNumber: { contains: q } } },
                { customer: { name: { contains: q } } },
                { customer: { email: { contains: q } } },
              ],
            }
          : {}),
      },
      include: {
        order: { select: { id: true, orderNumber: true } },
        customer: { select: { id: true, name: true, email: true, externalId: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });

    const counts = await prisma.supportTicket.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    const payload = JSON.parse(
      JSON.stringify({
        tickets,
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        total: tickets.length,
      }),
    );
    cacheSet(cacheKey, payload, isDefault ? 10_000 : 5_000);
    return jsonOk(payload);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load tickets", 500);
  }
}
