import { describe, expect, it } from "vitest";
import { buildCustomerStatusEmail, humanizeCustomerText } from "@/lib/customer-copy";

describe("customer-copy", () => {
  it("replaces technical status codes and ISO timestamps", () => {
    const text = humanizeCustomerText(
      'shippingStatus "not_shipped" updated 2026-10-04T09:03:39.144Z',
    );
    expect(text.toLowerCase()).not.toContain("not_shipped");
    expect(text).not.toMatch(/T\d{2}:\d{2}/);
    expect(text.toLowerCase()).toContain("has not shipped yet");
    expect(text).toMatch(/October 4, 2026/);
  });

  it("builds a readable status email", () => {
    const { body } = buildCustomerStatusEmail({
      customerName: "Alex",
      orderNumber: "ORD-1001",
      findings: ["not_shipped", "production is delayed"],
    });
    expect(body).toContain("Hi Alex");
    expect(body).toContain("ORD-1001");
    expect(body.toLowerCase()).not.toContain("not_shipped");
    expect(body).toMatch(/has not shipped yet/i);
  });
});
