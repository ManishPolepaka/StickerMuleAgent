import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

async function main() {
  const p = new PrismaClient();
  const task = await p.agentTask.findFirst({
    where: { taskNumber: "TASK-1001" },
    include: { order: true, approvals: true },
  });
  if (!task) {
    console.log("TASK-1001 not found");
    await p.$disconnect();
    return;
  }

  if (task.approvals.some((a) => a.status === "pending")) {
    console.log("Pending approval already exists");
    await p.$disconnect();
    return;
  }

  const key = createHash("sha256")
    .update(`${task.id}:issue_refund:repair`)
    .digest("hex")
    .slice(0, 32);

  const approval = await p.humanApproval.create({
    data: {
      taskId: task.id,
      proposedAction: "issue_refund",
      reason:
        "Customer requested a full refund for ORD-1030. Order is delivered; refund requires human approval.",
      evidenceJson: JSON.stringify({
        relatedOrderId: task.order?.orderNumber || "ORD-1030",
        source: "repair_missing_approval",
        restricted: true,
      }),
      status: "pending",
      idempotencyKey: key,
    },
  });

  await p.agentTask.update({
    where: { id: task.id },
    data: {
      status: "awaiting_approval",
      requiresHumanApproval: true,
      selectedAction: "issue_refund",
      completedAt: null,
    },
  });

  console.log(JSON.stringify({ repaired: true, approvalId: approval.id, taskStatus: "awaiting_approval" }, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
