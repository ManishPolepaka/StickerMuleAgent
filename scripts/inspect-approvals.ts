import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const tasks = await p.agentTask.findMany({
    where: { status: "awaiting_approval" },
    select: {
      id: true,
      taskNumber: true,
      status: true,
      requiresHumanApproval: true,
      selectedAction: true,
      approvals: { select: { id: true, status: true, proposedAction: true } },
    },
    take: 10,
  });
  console.log(JSON.stringify(tasks, null, 2));
  console.log("total approvals", await p.humanApproval.count());
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
