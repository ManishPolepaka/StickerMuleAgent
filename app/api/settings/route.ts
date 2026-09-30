import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { assertCanUpdateSettings } from "@/lib/agent/permissions";
import { jsonError, jsonOk, parseJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  agentEnabled: z.boolean(),
  provider: z.enum(["openai", "simulated", "anthropic", "xai", "ollama"]),
  modelName: z.string().min(1).max(100),
  maxIterations: z.number().int().min(1).max(30),
  executionTimeoutMs: z.number().int().min(5000).max(600000),
  requireApprovalForRestricted: z.literal(true),
  minEvidenceConfidence: z.enum(["low", "medium", "high"]),
  maxBudgetUsd: z.number().min(0).max(100).nullable(),
});

export async function GET() {
  try {
    let settings = await prisma.agentSettings.findUnique({ where: { id: "default" } });
    if (!settings) {
      settings = await prisma.agentSettings.create({
        data: {
          id: "default",
          provider: process.env.OPENAI_API_KEY ? "openai" : "simulated",
        },
      });
    }
    return jsonOk({
      settings,
      secrets: {
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        note: "API keys are stored in environment variables only.",
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load settings", 500);
  }
}

export async function PUT(request: Request) {
  try {
    assertCanUpdateSettings();
    const body = settingsSchema.parse(await parseJson(request));

    // Safety: never allow bypassing restricted-action approvals via config.
    if (!body.requireApprovalForRestricted) {
      return jsonError("requireApprovalForRestricted cannot be disabled.");
    }

    // Block arbitrary executable instructions in model name / provider.
    if (/[;`<>]|\$\(|\n/.test(body.modelName)) {
      return jsonError("Invalid model name.");
    }

    const settings = await prisma.agentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...body },
      update: body,
    });
    return jsonOk({ settings });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to update settings", 400);
  }
}
