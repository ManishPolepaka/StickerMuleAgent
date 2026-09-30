import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const task = await prisma.agentTask.findFirst({
    where: { taskNumber: "TASK-1004" },
    include: {
      executions: {
        include: { steps: { orderBy: { stepIndex: "asc" } } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!task) {
    console.log("TASK-1004 not found");
    return;
  }
  const steps = task.executions[0]?.steps || [];
  const completed = steps.find((s) => s.title.includes("Investigation completed"));
  console.log(
    JSON.stringify(
      {
        status: task.status,
        final: task.finalResultJson,
        tools: steps.map((s) => s.toolName).filter(Boolean),
        completedPreview: completed?.detail?.slice(0, 600) || null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
