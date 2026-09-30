import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { cacheInvalidate } from "@/lib/cache/memory";
import { isRestrictedAction } from "@/lib/agent/permissions";

/**
 * Ensure a pending HumanApproval exists ONLY for restricted actions
 * (refund/credit/cancel/address/compensation). Status emails do not qualify.
 */
export async function ensurePendingApproval(taskId: string) {
  const task = await prisma.agentTask.findUnique({
    where: { id: taskId },
    include: {
      approvals: { where: { status: "pending" }, take: 1 },
      order: { select: { orderNumber: true, id: true } },
    },
  });
  if (!task) return null;
  if (task.approvals.length > 0) return task.approvals[0];

  let proposed =
    task.selectedAction ||
    "Restricted commercial action requiring human approval";
  let reason = task.investigationSummary || "Restricted action gated for human review.";

  if (task.finalResultJson) {
    try {
      const parsed = JSON.parse(task.finalResultJson) as {
        proposedOrCompletedAction?: string;
        problemIdentified?: string;
        investigationSummary?: string;
      };
      if (parsed.proposedOrCompletedAction) proposed = parsed.proposedOrCompletedAction;
      if (parsed.problemIdentified || parsed.investigationSummary) {
        reason = parsed.investigationSummary || parsed.problemIdentified || reason;
      }
    } catch {
      // ignore
    }
  }

  // Status emails / tickets / monitoring never get approval rows.
  if (!isRestrictedAction(proposed)) {
    return null;
  }

  const key = createHash("sha256")
    .update(`${task.id}:ensure:${proposed}`)
    .digest("hex")
    .slice(0, 32);

  const existing = await prisma.humanApproval.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;

  const approval = await prisma.humanApproval.create({
    data: {
      taskId: task.id,
      proposedAction: proposed,
      reason,
      evidenceJson: JSON.stringify({
        relatedOrderId: task.order?.orderNumber || task.orderId,
        source: "ensure_pending_approval",
        restricted: true,
      }),
      status: "pending",
      idempotencyKey: key,
    },
  });

  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: "awaiting_approval",
      requiresHumanApproval: true,
      selectedAction: proposed,
    },
  });
  cacheInvalidate("tasks:");
  return approval;
}
