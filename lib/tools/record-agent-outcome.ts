import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  taskId: z.string().min(1),
  finalStatus: z.enum([
    "resolved",
    "awaiting_approval",
    "escalated",
    "failed",
    "needs_human",
  ]),
  actionsTaken: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  summary: z.string().min(1),
});

export const recordAgentOutcomeTool: AgentTool = {
  name: "record_agent_outcome",
  description: "Persist the final investigation outcome for dashboards and evaluations.",
  parameters: jsonSchemaFromZodShape(
    {
      taskId: { type: "string" },
      finalStatus: {
        type: "string",
        enum: ["resolved", "awaiting_approval", "escalated", "failed", "needs_human"],
      },
      actionsTaken: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    ["taskId", "finalStatus", "summary"],
  ),
  schema,
  async execute(input, ctx) {
    const parsed = schema.parse(input);
    const taskId = parsed.taskId === "CURRENT" ? ctx.taskId : parsed.taskId;

    const payload = {
      finalStatus: parsed.finalStatus,
      actionsTaken: parsed.actionsTaken,
      evidence: parsed.evidence,
      summary: parsed.summary,
      recordedAt: new Date().toISOString(),
    };

    await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: parsed.finalStatus,
        investigationSummary: parsed.summary,
        actionResult: JSON.stringify(payload),
        completedAt:
          parsed.finalStatus === "awaiting_approval" ? null : new Date(),
        finalResultJson: JSON.stringify(payload),
      },
    });

    return { ok: true, data: { taskId, recorded: true, ...payload } };
  },
};
