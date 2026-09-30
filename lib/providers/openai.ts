import OpenAI from "openai";
import type { ModelProvider, ProviderMessage, ProviderResponse } from "./types";

function toOpenAIMessages(messages: ProviderMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Rough USD estimate for dashboard display only (per 1M tokens). */
function estimateCost(model: string, promptTokens: number, completionTokens: number) {
  const rates: Record<string, { in: number; out: number }> = {
    "gpt-5-mini": { in: 0.25, out: 2.0 },
    "gpt-5-nano": { in: 0.05, out: 0.4 },
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  };
  const rate = rates[model] || rates["gpt-5-mini"];
  return (promptTokens * rate.in + completionTokens * rate.out) / 1_000_000;
}

function supportsTemperature(model: string) {
  // GPT-5 family chat models generally reject custom temperature.
  return !/^gpt-5/i.test(model);
}

export function createOpenAIProvider(): ModelProvider {
  return {
    id: "openai",
    displayName: "OpenAI",
    isSimulated: false,
    async complete({ model, messages, tools, temperature = 0.2 }): Promise<ProviderResponse> {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured.");
      }

      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model,
        ...(supportsTemperature(model) ? { temperature } : {}),
        messages: toOpenAIMessages(messages),
        tools: tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: "auto",
      });

      const choice = response.choices[0];
      const toolCalls =
        choice.message.tool_calls?.flatMap((tc) => {
          if (tc.type !== "function") return [];
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            args = {};
          }
          return [{ id: tc.id, name: tc.function.name, arguments: args }];
        }) ?? [];

      const usage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      return {
        content: choice.message.content,
        toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : "stop",
        usage,
        estimatedCostUsd: usage
          ? estimateCost(model, usage.promptTokens, usage.completionTokens)
          : undefined,
      };
    },
  };
}
