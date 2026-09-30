import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const task = await p.agentTask.findFirst({ where: { taskNumber: "TASK-1001" } });
  if (!task) {
    console.log("TASK-1001 not found");
    return;
  }
  const existing = await p.humanApproval.findFirst({ where: { taskId: task.id } });
  if (existing) {
    console.log("already has approval", existing.id);
    return;
  }
  const key = createHash("sha256").update(`${task.id}:ensure:repair`).digest("hex").slice(0, 32);
  const a = await p.humanApproval.create({
    data: {
      taskId: task.id,
      proposedAction: task.selectedAction || "Review investigation and approve next action",
      reason: task.investigationSummary || "Agent paused for human approval.",
      evidenceJson: "{}",
      status: "pending",
      idempotencyKey: key,
    },
  });
  await p.agentTask.update({
    where: { id: task.id },
    data: { requiresHumanApproval: true, status: "awaiting_approval" },
  });
  console.log("created approval", a.id);
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
