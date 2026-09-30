import { createOpenAIProvider } from "./openai";
import { createSimulatedProvider } from "./simulated";
import type { ModelProvider } from "./types";

export function getModelProvider(preferred?: string | null): ModelProvider {
  const choice = (preferred || process.env.MODEL_PROVIDER || "").toLowerCase();
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  if (choice === "simulated" || choice === "ollama" || choice === "anthropic" || choice === "xai") {
    if (choice === "simulated" || !hasOpenAI) return createSimulatedProvider();
  }

  if (choice === "openai" || (!choice && hasOpenAI)) {
    return createOpenAIProvider();
  }

  // Default: use OpenAI when key present, otherwise simulated demo provider.
  return hasOpenAI ? createOpenAIProvider() : createSimulatedProvider();
}

export type { ModelProvider } from "./types";
