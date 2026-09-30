import { getOrderDetailsTool } from "./get-order-details";
import { getProductionStatusTool } from "./get-production-status";
import { trackShipmentTool } from "./track-shipment";
import { getCustomerHistoryTool } from "./get-customer-history";
import { createSupportTicketTool } from "./create-support-ticket";
import { draftCustomerEmailTool } from "./draft-customer-email";
import { sendCustomerEmailTool } from "./send-customer-email";
import { requestHumanApprovalTool } from "./request-human-approval";
import { escalateTaskTool } from "./escalate-task";
import { recordAgentOutcomeTool } from "./record-agent-outcome";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { isRestrictedAction } from "@/lib/agent/permissions";

export const ALL_TOOLS: AgentTool[] = [
  getOrderDetailsTool,
  getProductionStatusTool,
  trackShipmentTool,
  getCustomerHistoryTool,
  createSupportTicketTool,
  draftCustomerEmailTool,
  sendCustomerEmailTool,
  requestHumanApprovalTool,
  escalateTaskTool,
  recordAgentOutcomeTool,
];

const toolMap = new Map(ALL_TOOLS.map((t) => [t.name, t]));

const READ_ONLY = new Set([
  "get_order_details",
  "get_production_status",
  "track_shipment",
  "get_customer_history",
  "draft_customer_email",
]);

export function getToolDefinitions() {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = toolMap.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  // Block disguised financial / irreversible side effects outside approval tool.
  if (
    name !== "request_human_approval" &&
    typeof args.proposedAction === "string" &&
    isRestrictedAction(args.proposedAction)
  ) {
    return {
      ok: false,
      error: "Restricted actions must go through request_human_approval.",
    };
  }

  if (name === "send_customer_email") {
    // Sending email is allowed in demo (simulated) but never real SMTP.
  }

  try {
    tool.schema.parse(args);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid tool arguments for ${name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    return await tool.execute(args, ctx);
  } catch (err) {
    return {
      ok: false,
      error: `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function isReadOnlyTool(name: string) {
  return READ_ONLY.has(name);
}
