import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const tasks = await p.agentTask.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      taskNumber: true,
      status: true,
      triggerType: true,
      createdAt: true,
      order: { select: { orderNumber: true } },
    },
  });
  console.log(JSON.stringify(tasks, null, 2));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
