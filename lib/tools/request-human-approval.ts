import { z } from "zod";
import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { isRestrictedAction } from "@/lib/agent/permissions";
import { cacheInvalidate } from "@/lib/cache/memory";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  proposedAction: z.string().min(1),
  reason: z.string().min(1),
  relatedOrderId: z.string().min(1),
  supportingEvidence: z.array(z.string()).default([]),
});

export const requestHumanApprovalTool: AgentTool = {
  name: "request_human_approval",
  description:
    "Pause for human approval ONLY for restricted actions: refunds, credits, discounts, cancellations, shipping-address changes, or compensation promises. Do NOT use for sending status emails, creating tickets, or monitoring shipments — those are auto-allowed.",
  parameters: jsonSchemaFromZodShape(
    {
      proposedAction: { type: "string" },
      reason: { type: "string" },
      relatedOrderId: { type: "string" },
      supportingEvidence: { type: "array", items: { type: "string" } },
    },
    ["proposedAction", "reason", "relatedOrderId"],
  ),
  schema,
  async execute(input, ctx) {
    const parsed = schema.parse(input);

    if (!isRestrictedAction(parsed.proposedAction)) {
      return {
        ok: false,
        error:
          "request_human_approval is only for restricted actions (refund/credit/cancel/address/compensation). Send status emails with send_customer_email and resolve the task without approval.",
      };
    }
    const key = createHash("sha256")
      .update(`${ctx.taskId}:${parsed.proposedAction}:${parsed.relatedOrderId}`)
      .digest("hex")
      .slice(0, 32);

    const existing = await prisma.humanApproval.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      return {
        ok: true,
        data: {
          approvalId: existing.id,
          status: existing.status,
          idempotent: true,
          pauseExecution: existing.status === "pending",
        },
      };
    }

    const approval = await prisma.humanApproval.create({
      data: {
        taskId: ctx.taskId,
        executionId: ctx.executionId,
        proposedAction: parsed.proposedAction,
        reason: parsed.reason,
        evidenceJson: JSON.stringify({
          relatedOrderId: parsed.relatedOrderId,
          supportingEvidence: parsed.supportingEvidence,
          restricted: isRestrictedAction(parsed.proposedAction),
        }),
        status: "pending",
        idempotencyKey: key,
      },
    });

    await prisma.agentTask.update({
      where: { id: ctx.taskId },
      data: {
        status: "awaiting_approval",
        requiresHumanApproval: true,
        selectedAction: parsed.proposedAction,
      },
    });

    cacheInvalidate("tasks:");

    return {
      ok: true,
      data: {
        approvalId: approval.id,
        status: "pending",
        pauseExecution: true,
        message: "Execution paused until a human approves or rejects this action.",
      },
    };
  },
};
