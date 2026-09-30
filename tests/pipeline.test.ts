import { describe, expect, it } from "vitest";
import {
  buildInvestigationPrompt,
  detectRestrictedFromText,
  resolvePipeline,
} from "@/lib/agent/pipeline";

describe("pipeline policy", () => {
  it("maps cancel/refund/address issue types to approval", () => {
    expect(resolvePipeline({ issueType: "cancel_request" }).kind).toBe("require_approval");
    expect(resolvePipeline({ issueType: "cancel_request" }).restrictedAction).toBe("cancel_order");
    expect(resolvePipeline({ issueType: "refund_request" }).restrictedAction).toBe("issue_refund");
    expect(resolvePipeline({ issueType: "incorrect_address" }).restrictedAction).toBe(
      "change_shipping_address",
    );
  });

  it("maps status issues to auto-resolve", () => {
    for (const issue of [
      "production_delay",
      "missing_tracking",
      "stale_tracking",
      "delivery_status_inquiry",
    ]) {
      expect(resolvePipeline({ issueType: issue }).kind).toBe("status_resolve");
    }
  });

  it("escalates delivered-not-received", () => {
    expect(resolvePipeline({ issueType: "delivered_not_received" }).kind).toBe("escalate_claim");
  });

  it("detects restricted intent from notes even with generic prompt", () => {
    const d = resolvePipeline({
      prompt: "Investigate why order ORD-1007 has not been delivered and determine what should happen next.",
      customerNotes: "Customer wants to cancel the order.",
    });
    expect(d.kind).toBe("require_approval");
    expect(d.restrictedAction).toBe("cancel_order");
  });

  it("builds cancel-aware investigation prompts", () => {
    const prompt = buildInvestigationPrompt("ORD-1007", "cancel_request");
    expect(prompt).toMatch(/request_human_approval/);
    expect(prompt).toMatch(/cancel_order/);
  });

  it("detectRestrictedFromText covers commercial verbs", () => {
    expect(detectRestrictedFromText("please refund me")).toBe("issue_refund");
    expect(detectRestrictedFromText("cancel my order")).toBe("cancel_order");
    expect(detectRestrictedFromText("wrong address please change")).toBe(
      "change_shipping_address",
    );
  });
});
