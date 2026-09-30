import type { ModelProvider, ProviderMessage, ProviderResponse, ToolCallRequest } from "./types";

function lastUserText(messages: ProviderMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return m.content;
  }
  return "";
}

function extractOrderId(text: string) {
  const match = text.match(/ORD-[A-Z0-9-]+/i);
  return match?.[0]?.toUpperCase() ?? null;
}

function calledTools(messages: ProviderMessage[]) {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) names.add(tc.name);
    }
  }
  return names;
}

function toolResults(messages: ProviderMessage[]) {
  return messages.filter((m) => m.role === "tool").map((m) => m.content);
}

function makeCall(name: string, args: Record<string, unknown>): ToolCallRequest {
  return {
    id: `sim_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    arguments: args,
  };
}

/**
 * Rule-based simulated LLM that drives the same tool loop for demos
 * when OPENAI_API_KEY is not configured. Clearly labeled as simulated.
 */
export function createSimulatedProvider(): ModelProvider {
  return {
    id: "simulated",
    displayName: "Simulated LLM (Demo)",
    isSimulated: true,
    async complete({ messages }): Promise<ProviderResponse> {
      const userText = lastUserText(messages);
      const orderId = extractOrderId(userText);
      const used = calledTools(messages);
      const results = toolResults(messages);
      const lower = userText.toLowerCase();

      const wantsRefund = /refund|credit|discount|compensat/.test(lower);
      const wantsCancel = /cancel/.test(lower);
      const wantsAddress = /address|change shipping|fix the shipping/.test(lower);
      const invalidOrder = orderId?.includes("DOES-NOT-EXIST") || orderId === "ORD-INVALID";

      if (!orderId && !invalidOrder) {
        return {
          content: null,
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
          estimatedCostUsd: 0,
        };
      }

      if (invalidOrder || orderId === "ORD-DOES-NOT-EXIST") {
        if (!used.has("get_order_details")) {
          return {
            content: "Looking up the order.",
            toolCalls: [makeCall("get_order_details", { orderId: orderId || "ORD-DOES-NOT-EXIST" })],
            finishReason: "tool_calls",
            usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
            estimatedCostUsd: 0,
          };
        }
        if (!used.has("escalate_task")) {
          const taskMatch = userText.match(/taskId["']?\s*[:=]\s*["']?([a-z0-9]+)/i);
          return {
            content: "Order not found. Escalating.",
            toolCalls: [
              makeCall("escalate_task", {
                taskId: taskMatch?.[1] || "CURRENT",
                escalationReason: "Order ID could not be found in the database.",
                supportingEvidence: ["get_order_details returned not found"],
                recommendedNextStep: "Ask the customer to confirm the order number.",
              }),
            ],
            finishReason: "tool_calls",
            usage: { promptTokens: 140, completionTokens: 60, totalTokens: 200 },
            estimatedCostUsd: 0,
          };
        }
        if (!used.has("record_agent_outcome")) {
          return {
            content: "Recording outcome.",
            toolCalls: [
              makeCall("record_agent_outcome", {
                taskId: "CURRENT",
                finalStatus: "escalated",
                actionsTaken: ["lookup_failed", "escalated"],
                evidence: ["Order not found"],
                summary:
                  "Could not find the requested order. Escalated for human follow-up. No order data was invented.",
              }),
            ],
            finishReason: "tool_calls",
            usage: { promptTokens: 150, completionTokens: 70, totalTokens: 220 },
            estimatedCostUsd: 0,
          };
        }
        return {
          content: JSON.stringify({
            problemIdentified: "Order not found",
            evidenceCollected: ["Database lookup returned no matching order"],
            investigationSummary: "The provided order ID does not exist in the demo database.",
            rootCause: null,
            proposedOrCompletedAction: "Escalated to human support",
            approvalRequired: false,
            customerResponse: null,
            remainingRisks: ["Customer may have provided an incorrect order ID"],
            finalTaskStatus: "escalated",
          }),
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 160, completionTokens: 120, totalTokens: 280 },
          estimatedCostUsd: 0,
        };
      }

      if (!used.has("get_order_details")) {
        return {
          content: "Retrieving order details.",
          toolCalls: [makeCall("get_order_details", { orderId })],
          finishReason: "tool_calls",
          usage: { promptTokens: 110, completionTokens: 30, totalTokens: 140 },
          estimatedCostUsd: 0,
        };
      }

      const orderJson = results[0] || "{}";
      let orderData: { customerId?: string; trackingNumber?: string | null; order?: { customerId?: string; trackingNumber?: string | null } } = {};
      try {
        orderData = JSON.parse(orderJson);
      } catch {
        orderData = {};
      }
      const customerId =
        (orderData as { customer?: { id?: string }; customerId?: string }).customer?.id ||
        (orderData as { customerId?: string }).customerId;
      const tracking =
        (orderData as { order?: { trackingNumber?: string } }).order?.trackingNumber ||
        (orderData as { trackingNumber?: string }).trackingNumber;

      if (!used.has("get_production_status")) {
        return {
          content: "Checking production status.",
          toolCalls: [makeCall("get_production_status", { orderId })],
          finishReason: "tool_calls",
          usage: { promptTokens: 130, completionTokens: 30, totalTokens: 160 },
          estimatedCostUsd: 0,
        };
      }

      if (!used.has("track_shipment")) {
        return {
          content: "Checking shipment tracking.",
          toolCalls: [
            makeCall("track_shipment", tracking ? { trackingNumber: tracking } : { orderId }),
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 140, completionTokens: 30, totalTokens: 170 },
          estimatedCostUsd: 0,
        };
      }

      if (customerId && !used.has("get_customer_history")) {
        return {
          content: "Reviewing customer history.",
          toolCalls: [makeCall("get_customer_history", { customerId })],
          finishReason: "tool_calls",
          usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
          estimatedCostUsd: 0,
        };
      }

      if (wantsRefund || wantsCancel || wantsAddress) {
        if (!used.has("request_human_approval")) {
          const action = wantsRefund
            ? "issue_refund"
            : wantsCancel
              ? "cancel_order"
              : "change_shipping_address";
          return {
            content: "Restricted action requires approval.",
            toolCalls: [
              makeCall("request_human_approval", {
                proposedAction: action,
                reason: `Customer or operator requested ${action.replace(/_/g, " ")}, which requires human approval.`,
                relatedOrderId: orderId,
                supportingEvidence: results.slice(0, 3),
              }),
            ],
            finishReason: "tool_calls",
            usage: { promptTokens: 180, completionTokens: 50, totalTokens: 230 },
            estimatedCostUsd: 0,
          };
        }
        if (!used.has("record_agent_outcome")) {
          return {
            content: "Recording pending approval outcome.",
            toolCalls: [
              makeCall("record_agent_outcome", {
                taskId: "CURRENT",
                finalStatus: "awaiting_approval",
                actionsTaken: ["investigated", "requested_approval"],
                evidence: ["Restricted action gated by permissions"],
                summary: "Investigation complete. Restricted action awaiting human approval.",
              }),
            ],
            finishReason: "tool_calls",
            usage: { promptTokens: 170, completionTokens: 60, totalTokens: 230 },
            estimatedCostUsd: 0,
          };
        }
        return {
          content: JSON.stringify({
            problemIdentified: "Restricted action requested",
            evidenceCollected: ["Order and shipping/production evidence collected"],
            investigationSummary: "A restricted commercial action was requested and gated for human approval.",
            rootCause: null,
            proposedOrCompletedAction: "Requested human approval",
            approvalRequired: true,
            customerResponse: null,
            remainingRisks: ["Action not executed until approved"],
            finalTaskStatus: "awaiting_approval",
          }),
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 200, completionTokens: 140, totalTokens: 340 },
          estimatedCostUsd: 0,
        };
      }

      const joined = results.join(" ").toLowerCase();
      const productionDelay = joined.includes("delay") || joined.includes("delayed");
      const deliveredDispute = /not received|stole|delivered/.test(lower) && joined.includes("delivered");
      const staleTracking = joined.includes("in_transit") && /lost|tracking/.test(lower);
      const missingTracking = joined.includes("\"trackingnumber\":null") || joined.includes("missing tracking");

      if (deliveredDispute && !used.has("escalate_task")) {
        return {
          content: "Cannot verify delivery with customer; escalating.",
          toolCalls: [
            makeCall("escalate_task", {
              taskId: "CURRENT",
              escalationReason:
                "Carrier marks delivered but customer reports non-receipt. Cannot independently verify possession.",
              supportingEvidence: results.slice(0, 2),
              recommendedNextStep: "Open carrier claim and contact customer for porch/photo check.",
            }),
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 190, completionTokens: 50, totalTokens: 240 },
          estimatedCostUsd: 0,
        };
      }

      if ((missingTracking || productionDelay || staleTracking) && !used.has("create_support_ticket")) {
        return {
          content: "Creating internal support ticket.",
          toolCalls: [
            makeCall("create_support_ticket", {
              orderId,
              issueCategory: productionDelay
                ? "production_delay"
                : missingTracking
                  ? "missing_tracking"
                  : "stale_tracking",
              description: `Automated investigation finding for ${orderId}`,
              priority: "medium",
            }),
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 180, completionTokens: 40, totalTokens: 220 },
          estimatedCostUsd: 0,
        };
      }

      if (!used.has("draft_customer_email")) {
        return {
          content: "Drafting customer email from verified findings only.",
          toolCalls: [
            makeCall("draft_customer_email", {
              orderId,
              verifiedFindings: productionDelay
                ? [
                    "Your order is still in production",
                    "Production is delayed due to a material shortage",
                    "The order has not shipped yet",
                  ]
                : staleTracking
                  ? [
                      "Your shipment is in transit",
                      "The latest tracking update is a few days old",
                      "We have not confirmed the package as lost",
                    ]
                  : deliveredDispute
                    ? [
                        "The carrier shows the package as delivered",
                        "We are escalating this so a teammate can help verify what happened",
                      ]
                    : ["We reviewed your order using our available order and shipping records"],
              intendedCommunication:
                "We are continuing to monitor this and will follow up if anything meaningful changes.",
            }),
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 },
          estimatedCostUsd: 0,
        };
      }

      // Status updates: send the drafted email directly (no human approval).
      if (!deliveredDispute && !used.has("send_customer_email")) {
        let to = "customer@example.com";
        let subject = `Update on your order ${orderId}`;
        let message =
          "We reviewed your order and wanted to share a verified status update. Thank you for your patience.";
        for (const r of results) {
          try {
            const parsed = JSON.parse(r) as {
              ok?: boolean;
              data?: { to?: string; subject?: string; body?: string };
            };
            if (parsed?.ok && parsed.data?.body) {
              to = parsed.data.to || to;
              subject = parsed.data.subject || subject;
              message = parsed.data.body;
              break;
            }
          } catch {
            // ignore non-JSON tool payloads
          }
        }
        return {
          content: "Sending simulated status email to the customer.",
          toolCalls: [
            makeCall("send_customer_email", {
              customerEmail: to,
              subject,
              message,
              relatedOrderId: orderId,
            }),
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 },
          estimatedCostUsd: 0,
        };
      }

      if (!used.has("record_agent_outcome")) {
        const status = deliveredDispute
          ? "escalated"
          : staleTracking
            ? "resolved"
            : productionDelay
              ? "resolved"
              : "resolved";
        return {
          content: "Recording final outcome.",
          toolCalls: [
            makeCall("record_agent_outcome", {
              taskId: "CURRENT",
              finalStatus: status,
              actionsTaken: Array.from(used),
              evidence: results.slice(0, 4).map((r) => r.slice(0, 200)),
              summary: productionDelay
                ? "Identified production delay and sent simulated customer status email."
                : staleTracking
                  ? "Tracking is stale but package not confirmed lost; sent careful status email."
                  : deliveredDispute
                    ? "Delivery dispute escalated due to insufficient evidence."
                    : "Investigation completed and customer notified with simulated status email.",
            }),
          ],
          finishReason: "tool_calls",
          usage: { promptTokens: 210, completionTokens: 70, totalTokens: 280 },
          estimatedCostUsd: 0,
        };
      }

      return {
        content: JSON.stringify({
          problemIdentified: productionDelay
            ? "Production delay"
            : staleTracking
              ? "Stale tracking updates"
              : deliveredDispute
                ? "Delivery dispute"
                : "Operational delay investigation",
          evidenceCollected: [
            "Order details retrieved from database",
            "Production status checked via simulated production tool",
            "Shipment status checked via simulated shipping tool",
            ...(used.has("send_customer_email")
              ? ["Simulated status email sent to customer"]
              : []),
          ],
          investigationSummary:
            "Simulated LLM completed a tool-using investigation using only returned evidence.",
          rootCause: productionDelay
            ? "Production delay reported in simulated production system"
            : staleTracking
              ? "No recent tracking scans; loss not confirmed"
              : deliveredDispute
                ? null
                : "See evidence",
          proposedOrCompletedAction: deliveredDispute
            ? "Escalated for human follow-up"
            : used.has("send_customer_email")
              ? "Sent simulated customer status email and created support ticket where applicable"
              : "Drafted customer communication and created support ticket where applicable",
          approvalRequired: false,
          customerResponse: used.has("send_customer_email")
            ? "Simulated status email sent from verified findings"
            : "Draft email prepared from verified findings",
          remainingRisks: staleTracking
            ? ["Package could still become lost; monitor next scan"]
            : deliveredDispute
              ? ["Cannot confirm theft or misdelivery without more evidence"]
              : [],
          finalTaskStatus: deliveredDispute ? "escalated" : "resolved",
        }),
        toolCalls: [],
        finishReason: "stop",
        usage: { promptTokens: 220, completionTokens: 180, totalTokens: 400 },
        estimatedCostUsd: 0,
      };
    },
  };
}
