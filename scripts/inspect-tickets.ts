import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const task = await prisma.agentTask.findFirst({
    where: { taskNumber: "TASK-1004" },
    include: {
      order: true,
      emails: true,
      executions: {
        include: { steps: true },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const tickets = task?.orderId
    ? await prisma.supportTicket.findMany({
        where: { orderId: task.orderId },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const ticketStep = task?.executions[0]?.steps.find(
    (s) => s.toolName === "create_support_ticket" && s.toolResultJson?.includes('"ok":true'),
  );
  const draftStep = task?.executions[0]?.steps.find(
    (s) => s.toolName === "draft_customer_email" && s.toolResultJson?.includes('"ok":true'),
  );

  console.log(
    JSON.stringify(
      {
        task: task?.taskNumber,
        order: task?.order?.orderNumber,
        tickets,
        simulatedEmails: task?.emails,
        ticketToolResult: ticketStep?.toolResultJson,
        draftToolResult: draftStep?.toolResultJson?.slice(0, 800),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
