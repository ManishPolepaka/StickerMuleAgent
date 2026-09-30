import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  taskId: z.string().min(1),
  escalationReason: z.string().min(1),
  supportingEvidence: z.array(z.string()).default([]),
  recommendedNextStep: z.string().min(1),
});

export const escalateTaskTool: AgentTool = {
  name: "escalate_task",
  description: "Mark the task as requiring human intervention and record the reason.",
  parameters: jsonSchemaFromZodShape(
    {
      taskId: { type: "string" },
      escalationReason: { type: "string" },
      supportingEvidence: { type: "array", items: { type: "string" } },
      recommendedNextStep: { type: "string" },
    },
    ["taskId", "escalationReason", "recommendedNextStep"],
  ),
  schema,
  async execute(input, ctx) {
    const parsed = schema.parse(input);
    const taskId = parsed.taskId === "CURRENT" ? ctx.taskId : parsed.taskId;

    await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: "escalated",
        requiresHumanApproval: true,
        actionResult: JSON.stringify({
          escalationReason: parsed.escalationReason,
          supportingEvidence: parsed.supportingEvidence,
          recommendedNextStep: parsed.recommendedNextStep,
        }),
        reasoningSummary: parsed.escalationReason,
      },
    });

    return {
      ok: true,
      data: {
        taskId,
        status: "escalated",
        recommendedNextStep: parsed.recommendedNextStep,
      },
    };
  },
};
