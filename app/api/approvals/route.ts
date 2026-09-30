import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { assertCanApprove } from "@/lib/agent/permissions";
import { jsonError, jsonOk, parseJson } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache/memory";
import { publishRealtime } from "@/lib/realtime/events";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
  reviewer: z.string().optional(),
});

export async function GET() {
  try {
    const approvals = await prisma.humanApproval.findMany({
      include: { task: { include: { order: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jsonOk({ approvals });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load approvals", 500);
  }
}

export async function POST(request: Request) {
  try {
    assertCanApprove();
    const body = await parseJson<{ approvalId: string } & z.infer<typeof reviewSchema>>(request);
    const parsed = reviewSchema.parse(body);
    if (!body.approvalId) return jsonError("approvalId required");

    const approval = await prisma.humanApproval.findUnique({ where: { id: body.approvalId } });
    if (!approval) return jsonError("Approval not found", 404);
    if (approval.status !== "pending") {
      return jsonError(`Approval already ${approval.status}`, 409);
    }

    const updated = await prisma.humanApproval.update({
      where: { id: approval.id },
      data: {
        status: parsed.decision,
        reviewerComment: parsed.comment,
        reviewedBy: parsed.reviewer || "demo-admin",
        reviewedAt: new Date(),
      },
    });

    const nextStatus = parsed.decision === "rejected" ? "escalated" : "resolved";

    if (parsed.decision === "rejected") {
      await prisma.agentTask.update({
        where: { id: approval.taskId },
        data: {
          status: "escalated",
          actionResult: `Approval rejected: ${parsed.comment || "no comment"}`,
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.agentTask.update({
        where: { id: approval.taskId },
        data: {
          status: "resolved",
          actionResult: JSON.stringify({
            approval: "approved",
            note: "Restricted action approved for human operators. No automated financial transaction was executed in this demo.",
            proposedAction: approval.proposedAction,
          }),
          completedAt: new Date(),
        },
      });
    }

    publishRealtime({
      type: "task_updated",
      taskId: approval.taskId,
      status: nextStatus,
    });
    publishRealtime({ type: "dashboard_changed", reason: "approval_reviewed" });
    cacheInvalidate("tasks:");
    cacheInvalidate("dashboard:");

    return jsonOk({ approval: updated });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to review approval", 400);
  }
}
