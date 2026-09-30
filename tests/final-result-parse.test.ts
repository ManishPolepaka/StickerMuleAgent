import { describe, expect, it } from "vitest";
import { AgentFinalResultSchema } from "@/lib/providers/types";

// Mirror synthesize logic expectations via runtime exports would be ideal;
// test schema + prose JSON fence parsing pattern used by the agent runtime.

function tryParseFinal(content: string | null) {
  if (!content) return null;
  const candidates: string[] = [];
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const allObjects = content.match(/\{[\s\S]*\}/g);
  if (allObjects) candidates.push(...[...allObjects].sort((a, b) => b.length - a.length));
  candidates.push(content.trim());
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      const result = AgentFinalResultSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // continue
    }
  }
  return null;
}

describe("final result parsing", () => {
  it("parses JSON inside markdown fences", () => {
    const content = `Here is the result:\n\`\`\`json\n${JSON.stringify({
      problemIdentified: "Production delay",
      evidenceCollected: ["Delay confirmed"],
      investigationSummary: "Order delayed in print queue",
      rootCause: "Material shortage",
      proposedOrCompletedAction: "Drafted customer update",
      approvalRequired: false,
      customerResponse: "Draft ready",
      remainingRisks: [],
      finalTaskStatus: "resolved",
    })}\n\`\`\``;
    const parsed = tryParseFinal(content);
    expect(parsed?.finalTaskStatus).toBe("resolved");
    expect(parsed?.rootCause).toBe("Material shortage");
  });

  it("rejects incomplete prose without JSON", () => {
    expect(tryParseFinal("**Problem Identified:** delay")).toBeNull();
  });
});
