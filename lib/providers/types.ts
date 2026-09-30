import { z } from "zod";

export const AgentFinalResultSchema = z.object({
  problemIdentified: z.string(),
  evidenceCollected: z.array(z.string()),
  investigationSummary: z.string(),
  rootCause: z.string().nullable(),
  proposedOrCompletedAction: z.string(),
  approvalRequired: z.boolean(),
  customerResponse: z.string().nullable(),
  remainingRisks: z.array(z.string()),
  finalTaskStatus: z.enum([
    "resolved",
    "awaiting_approval",
    "escalated",
    "failed",
    "needs_human",
  ]),
});

export type AgentFinalResult = z.infer<typeof AgentFinalResultSchema>;

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; content: string };

export type ProviderResponse = {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: "tool_calls" | "stop" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  estimatedCostUsd?: number;
};

export type ModelProvider = {
  id: string;
  displayName: string;
  isSimulated: boolean;
  complete(args: {
    model: string;
    messages: ProviderMessage[];
    tools: ToolDefinition[];
    temperature?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<ProviderResponse>;
};
