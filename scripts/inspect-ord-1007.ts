import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const order = await p.order.findFirst({
    where: { orderNumber: "ORD-1007" },
    include: {
      customer: true,
      productionRecords: { orderBy: { updatedAt: "desc" }, take: 2 },
      shipmentEvents: { orderBy: { eventAt: "desc" }, take: 5 },
      supportTickets: { orderBy: { createdAt: "desc" }, take: 3 },
      tasks: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          taskNumber: true,
          status: true,
          prompt: true,
          investigationSummary: true,
          issueType: true,
          selectedAction: true,
          requiresHumanApproval: true,
          emails: { orderBy: { createdAt: "desc" }, take: 2 },
        },
      },
    },
  });

  const messages = await p.incomingMessage.findMany({
    where: { OR: [{ orderNumber: "ORD-1007" }, { fromEmail: order?.customer.email }] },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log(JSON.stringify({ order, messages }, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
