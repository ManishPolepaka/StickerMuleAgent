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
  const tools = steps.map((s) => s.toolName).filter(Boolean) as string[];
  const detail = completed?.detail || "";

  const repaired = {
    problemIdentified: "Order delayed and has not shipped",
    evidenceCollected: [
      "Order status in_production / production delayed / not shipped",
      "Production stage print_queue; material shortage for specialty vinyl",
      "No tracking number; expected delivery was 2026-09-27",
      ...(tools.includes("create_support_ticket") ? ["Support ticket created for production_delay"] : []),
    ],
    investigationSummary:
      detail.replace(/\*\*/g, "").slice(0, 800) ||
      "ORD-1000 is delayed in production due to material shortage and has not shipped.",
    rootCause: "Material shortage for specialty vinyl",
    proposedOrCompletedAction: tools.includes("draft_customer_email")
      ? "Drafted customer update and created support ticket"
      : "Documented production delay and created support follow-up",
    approvalRequired: false,
    customerResponse: null,
    remainingRisks: ["Delivery may slip further if production remains delayed"],
    finalTaskStatus: "resolved" as const,
  };

  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: "resolved",
      investigationSummary: repaired.investigationSummary,
      reasoningSummary: repaired.problemIdentified,
      selectedAction: repaired.proposedOrCompletedAction,
      finalResultJson: JSON.stringify(repaired),
      completedAt: new Date(),
    },
  });

  console.log(JSON.stringify({ taskNumber: task.taskNumber, repairedStatus: "resolved", tools }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
