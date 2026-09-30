import { describe, expect, it } from "vitest";
import { routeTrigger, extractOrderNumber } from "@/lib/triggers/router";

describe("trigger router", () => {
  it("extracts order numbers", () => {
    expect(extractOrderNumber("About ORD-1005 please")).toBe("ORD-1005");
  });

  it("starts agent for delivery questions", () => {
    const d = routeTrigger({
      triggerType: "customer_message",
      subject: "Where is my order?",
      body: "Hi, where is ORD-1000?",
    });
    expect(d.shouldStartAgent).toBe(true);
    expect(d.orderNumber).toBe("ORD-1000");
    expect(d.classification).toBe("delivery_inquiry");
  });

  it("ignores greeting-only messages", () => {
    const d = routeTrigger({
      triggerType: "customer_message",
      subject: "Hi",
      body: "Hello",
    });
    expect(d.shouldStartAgent).toBe(false);
  });

  it("routes refunds to approval-aware prompt", () => {
    const d = routeTrigger({
      triggerType: "customer_message",
      subject: "Refund",
      body: "Please refund ORD-1006",
    });
    expect(d.shouldStartAgent).toBe(true);
    expect(d.issueType).toBe("refund_request");
    expect(d.prompt.toLowerCase()).toContain("approval");
  });

  it("skips routine shipping updates", () => {
    const d = routeTrigger({
      triggerType: "shipping_webhook",
      orderNumber: "ORD-1001",
      shippingStatus: "in_transit",
    });
    expect(d.shouldStartAgent).toBe(false);
  });

  it("starts agent for shipping exceptions", () => {
    const d = routeTrigger({
      triggerType: "shipping_webhook",
      orderNumber: "ORD-1002",
      shippingStatus: "address_issue",
    });
    expect(d.shouldStartAgent).toBe(true);
  });
});
