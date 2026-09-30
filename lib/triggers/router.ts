export type TriggerType =
  | "customer_message"
  | "late_order"
  | "shipping_webhook"
  | "production_delay"
  | "sla_breach"
  | "bulk_scan"
  | "manual";

export type RouterDecision = {
  shouldStartAgent: boolean;
  reason: string;
  priority: "low" | "medium" | "high" | "urgent";
  issueType: string | null;
  prompt: string;
  orderNumber: string | null;
  classification: string;
};

const ORDER_REF = /ORD-[A-Z0-9-]+/i;

export function extractOrderNumber(text: string): string | null {
  const match = text.match(ORDER_REF);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Rule/keyword router: decides WHETHER to start the agent and builds the prompt.
 * The LLM agent still decides HOW to investigate after start.
 */
export function routeTrigger(input: {
  triggerType: TriggerType;
  subject?: string;
  body?: string;
  orderNumber?: string | null;
  shippingStatus?: string | null;
  productionDelay?: boolean;
  hoursOpen?: number;
}): RouterDecision {
  const text = `${input.subject || ""} ${input.body || ""}`.toLowerCase();
  const orderNumber =
    input.orderNumber ||
    extractOrderNumber(`${input.subject || ""} ${input.body || ""}`);

  if (input.triggerType === "customer_message") {
    const wantsRefund = /refund|money back|charge back/.test(text);
    const wantsCancel = /cancel (my )?order|cancel it/.test(text);
    const addressChange = /wrong address|change (the )?address|ship to/.test(text);
    const delivery = /where is|tracking|not (yet )?delivered|late|delayed|status|haven't received|did not receive|missing package/.test(
      text,
    );
    const greetingOnly = /^(hi|hello|thanks|thank you)[.! ]*$/i.test(
      (input.body || "").trim(),
    );

    if (greetingOnly && !orderNumber) {
      return {
        shouldStartAgent: false,
        reason: "Message looks like a greeting with no order context.",
        priority: "low",
        issueType: null,
        prompt: "",
        orderNumber,
        classification: "ignore_greeting",
      };
    }

    if (wantsRefund) {
      return {
        shouldStartAgent: true,
        reason: "Customer requested a refund — agent must investigate and request approval.",
        priority: "high",
        issueType: "refund_request",
        prompt: `Customer message requests a refund${orderNumber ? ` for ${orderNumber}` : ""}. Investigate with tools, then request human approval. Do not issue a refund yourself.\n\nCustomer said:\n${input.body}`,
        orderNumber,
        classification: "refund_request",
      };
    }

    if (wantsCancel) {
      return {
        shouldStartAgent: true,
        reason: "Cancel request — agent investigates and requests approval.",
        priority: "high",
        issueType: "cancel_request",
        prompt: `Customer wants to cancel${orderNumber ? ` ${orderNumber}` : " an order"}. Investigate status, then request human approval. Do not cancel autonomously.\n\nCustomer said:\n${input.body}`,
        orderNumber,
        classification: "cancel_request",
      };
    }

    if (addressChange) {
      return {
        shouldStartAgent: true,
        reason: "Address change requires investigation + approval.",
        priority: "high",
        issueType: "incorrect_address",
        prompt: `Customer reports an address issue${orderNumber ? ` for ${orderNumber}` : ""}. Investigate and request human approval before any address change.\n\nCustomer said:\n${input.body}`,
        orderNumber,
        classification: "address_change",
      };
    }

    if (delivery || orderNumber) {
      return {
        shouldStartAgent: true,
        reason: "Delivery / order status inquiry.",
        priority: "medium",
        issueType: "delivery_status_inquiry",
        prompt: `Customer asked about delivery/status${orderNumber ? ` for ${orderNumber}` : ""}. Investigate using tools, then send a verified status email via send_customer_email (no approval needed for status updates). Do not invent dates or refunds.\n\nSubject: ${input.subject || "(none)"}\nMessage:\n${input.body}`,
        orderNumber,
        classification: "delivery_inquiry",
      };
    }

    return {
      shouldStartAgent: false,
      reason: "Could not classify as an order operations issue.",
      priority: "low",
      issueType: null,
      prompt: "",
      orderNumber,
      classification: "unclassified",
    };
  }

  if (input.triggerType === "late_order") {
    return {
      shouldStartAgent: true,
      reason: "Expected delivery date passed and order not delivered.",
      priority: "high",
      issueType: "production_delay",
      prompt: `Automatic late-order scan found ${orderNumber} past expected delivery and not marked delivered. Investigate why and determine next steps.`,
      orderNumber: orderNumber,
      classification: "late_order",
    };
  }

  if (input.triggerType === "shipping_webhook") {
    const status = (input.shippingStatus || "").toLowerCase();
    const serious = ["address_issue", "exception", "undeliverable", "returned"].some((s) =>
      status.includes(s),
    );
    if (!serious && !/delayed|stale/.test(status)) {
      return {
        shouldStartAgent: false,
        reason: `Routine shipping update (${status || "unknown"}) — no agent needed.`,
        priority: "low",
        issueType: null,
        prompt: "",
        orderNumber,
        classification: "shipping_routine",
      };
    }
    return {
      shouldStartAgent: true,
      reason: `Shipping exception/status ${status} requires investigation.`,
      priority: "high",
      issueType: "stale_tracking",
      prompt: `Simulated carrier webhook for ${orderNumber}: status=${status}. Investigate shipment and decide next steps. Do not invent loss claims.`,
      orderNumber,
      classification: "shipping_exception",
    };
  }

  if (input.triggerType === "production_delay") {
    return {
      shouldStartAgent: true,
      reason: "Production system reported a delay.",
      priority: "medium",
      issueType: "production_delay",
      prompt: `Simulated production system reported a delay for ${orderNumber}. Investigate production status, then send a verified customer status email via send_customer_email (no human approval needed for status updates). Do not invent dates or refunds.`,
      orderNumber,
      classification: "production_delay",
    };
  }

  if (input.triggerType === "sla_breach") {
    return {
      shouldStartAgent: true,
      reason: `Support ticket open ${input.hoursOpen ?? "?"} hours without resolution.`,
      priority: "urgent",
      issueType: "delivery_status_inquiry",
      prompt: `SLA breach: related order ${orderNumber} has an open support item past the response window. Investigate and advance the case.`,
      orderNumber,
      classification: "sla_breach",
    };
  }

  if (input.triggerType === "bulk_scan") {
    return {
      shouldStartAgent: true,
      reason: "Included in operator bulk delayed-order scan.",
      priority: "medium",
      issueType: "production_delay",
      prompt: `Bulk delayed-order scan selected ${orderNumber}. Investigate and determine next steps.`,
      orderNumber,
      classification: "bulk_scan",
    };
  }

  return {
    shouldStartAgent: true,
    reason: "Manual trigger.",
    priority: "medium",
    issueType: null,
    prompt: input.body || `Investigate ${orderNumber || "the reported issue"}.`,
    orderNumber,
    classification: "manual",
  };
}
