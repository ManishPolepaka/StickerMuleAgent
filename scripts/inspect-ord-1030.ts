import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const order = await p.order.findFirst({
    where: { orderNumber: "ORD-1030" },
    include: {
      customer: true,
      tasks: {
        orderBy: { createdAt: "desc" },
        take: 3,
        include: {
          approvals: true,
          emails: true,
          executions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { steps: { orderBy: { stepIndex: "asc" } } },
          },
        },
      },
      supportTickets: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
  console.log(JSON.stringify(order, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
