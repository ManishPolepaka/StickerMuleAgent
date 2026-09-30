import { prisma } from "@/lib/db/prisma";
import { createStaticSwrLoader } from "@/lib/cache/swr";

const ordersLoader = createStaticSwrLoader(
  "orders:list:",
  async () => {
    const orders = await prisma.order.findMany({
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
    return JSON.parse(JSON.stringify({ orders })) as { orders: unknown[] };
  },
  60_000,
);

const customersLoader = createStaticSwrLoader(
  "customers:list",
  async () => {
    const customers = await prisma.customer.findMany({
      include: {
        _count: { select: { orders: true, supportHistory: true } },
      },
      orderBy: { name: "asc" },
    });
    return JSON.parse(JSON.stringify({ customers })) as { customers: unknown[] };
  },
  60_000,
);

const executionsLoader = createStaticSwrLoader(
  "executions:list",
  async () => {
    const executions = await prisma.agentExecution.findMany({
      select: {
        id: true,
        agentName: true,
        status: true,
        modelProvider: true,
        modelName: true,
        durationMs: true,
        totalTokens: true,
        estimatedCostUsd: true,
        createdAt: true,
        task: { select: { id: true, taskNumber: true, prompt: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return JSON.parse(JSON.stringify({ executions })) as { executions: unknown[] };
  },
  60_000,
);

const ticketsLoader = createStaticSwrLoader(
  "tickets:list:default",
  async () => {
    const [tickets, counts] = await Promise.all([
      prisma.supportTicket.findMany({
        include: {
          order: { select: { id: true, orderNumber: true } },
          customer: { select: { id: true, name: true, email: true, externalId: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 200,
      }),
      prisma.supportTicket.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);
    return JSON.parse(
      JSON.stringify({
        tickets,
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        total: tickets.length,
      }),
    ) as { tickets: unknown[]; counts: Record<string, number>; total: number };
  },
  60_000,
);

export const getOrdersList = () => ordersLoader.get();
export const warmOrdersList = () => ordersLoader.warm();
export const getCustomersList = () => customersLoader.get();
export const warmCustomersList = () => customersLoader.warm();
export const getExecutionsList = () => executionsLoader.get();
export const warmExecutionsList = () => executionsLoader.warm();
export const getTicketsList = () => ticketsLoader.get();
export const warmTicketsList = () => ticketsLoader.warm();
