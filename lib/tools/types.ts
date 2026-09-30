import { z } from "zod";

export type ToolContext = {
  taskId: string;
  executionId: string;
  actorRole: string;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodTypeAny;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

export function jsonSchemaFromZodShape(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
