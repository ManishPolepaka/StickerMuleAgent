import { isRestrictedAction } from "@/lib/agent/permissions";

export type PipelineKind = "status_resolve" | "require_approval" | "escalate_claim";

export type PipelineDecision = {
  kind: PipelineKind;
  /** Restricted action key when kind === require_approval */
  restrictedAction?: string;
  reason: string;
  label: string;
};

const ISSUE_PIPELINE: Record<string, PipelineDecision> = {
  cancel_request: {
    kind: "require_approval",
    restrictedAction: "cancel_order",
    reason: "Order has an open cancellation request — must pause for human approval.",
    label: "Cancel request",
  },
  refund_request: {
    kind: "require_approval",
    restrictedAction: "issue_refund",
    reason: "Order has a refund request — must pause for human approval.",
    label: "Refund request",
  },
  incorrect_address: {
    kind: "require_approval",
    restrictedAction: "change_shipping_address",
    reason: "Address change / undeliverable address — must pause for human approval.",
    label: "Address change",
  },
  production_delay: {
    kind: "status_resolve",
    reason: "Production delay — investigate and send a verified status email.",
    label: "Production delay",
  },
  missing_tracking: {
    kind: "status_resolve",
    reason: "Missing tracking — investigate and send a verified status email.",
    label: "Missing tracking",
  },
  stale_tracking: {
    kind: "status_resolve",
    reason: "Stale / exception tracking — investigate and send a verified status update.",
    label: "Stale tracking",
  },
  delivery_status_inquiry: {
    kind: "status_resolve",
    reason: "Delivery status inquiry — investigate and send a verified status email.",
    label: "Delivery status",
  },
  delivered_not_received: {
    kind: "escalate_claim",
    reason:
      "Carrier shows delivered but customer disputes receipt — investigate, ticket/status, then escalate (do not refund).",
    label: "Delivered not received",
  },
};

/** Detect restricted commercial intent from free text. */
export function detectRestrictedFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/refund|money back|charge\s*back/.test(t)) return "issue_refund";
  if (/credit(?!\s*card)|store credit/.test(t)) return "issue_credit";
  if (/discount|coupon|percent off/.test(t)) return "issue_discount";
  if (/cancel(l)?(ation|ing)?|cancel (my )?order/.test(t)) return "cancel_order";
  if (/wrong address|change (the )?address|incorrect address|ship to a new|update (the )?address/.test(t)) {
    return "change_shipping_address";
  }
  if (/compensat|make it right with|goodwill/.test(t)) return "promise_compensation";
  return null;
}

/**
 * Decide the required pipeline for a task from issue type + prompt + order notes.
 * Hard gate used after the model runs so OpenAI cannot "resolve" cancel/refund cases.
 */
export function resolvePipeline(input: {
  issueType?: string | null;
  orderIssueType?: string | null;
  prompt?: string | null;
  customerNotes?: string | null;
  proposedAction?: string | null;
}): PipelineDecision {
  const issue = (input.issueType || input.orderIssueType || "").toLowerCase().trim();
  if (issue && ISSUE_PIPELINE[issue]) return ISSUE_PIPELINE[issue];

  const blob = [input.prompt, input.customerNotes, input.proposedAction].filter(Boolean).join("\n");
  const fromText = detectRestrictedFromText(blob);
  if (fromText) {
    return {
      kind: "require_approval",
      restrictedAction: fromText,
      reason: `Detected restricted intent (${fromText.replace(/_/g, " ")}) — must pause for human approval.`,
      label: fromText.replace(/_/g, " "),
    };
  }

  if (input.proposedAction && isRestrictedAction(input.proposedAction)) {
    return {
      kind: "require_approval",
      restrictedAction: input.proposedAction.toLowerCase().replace(/\s+/g, "_"),
      reason: "Proposed action is restricted and requires human approval.",
      label: "Restricted action",
    };
  }

  return {
    kind: "status_resolve",
    reason: "Standard status investigation — status email + resolve (no approval).",
    label: "Status investigation",
  };
}

/** Prompt used when operator picks an order in Run Investigation. */
export function buildInvestigationPrompt(orderNumber: string, issueType: string | null | undefined): string {
  const pipeline = resolvePipeline({ issueType });
  const order = orderNumber.trim().toUpperCase();

  switch (pipeline.kind) {
    case "require_approval":
      return (
        `Investigate ${order} (${pipeline.label}). ` +
        `Use tools to verify order/production/shipping/customer evidence. ` +
        `Create an internal support ticket for the ops review queue, then call request_human_approval for ${pipeline.restrictedAction}. ` +
        `You may send a short status email that the request is under review — do NOT execute the restricted action, do NOT mark resolved, and do NOT offer the customer a choice that bypasses approval.`
      );
    case "escalate_claim":
      return (
        `Investigate ${order} (delivered-not-received claim). ` +
        `Verify carrier delivery evidence with tools, create a support ticket if needed, ` +
        `send a careful status email (no refund promises), then escalate_task for human review. Do not issue a refund.`
      );
    default:
      return (
        `Investigate why order ${order} has not been delivered / needs a status update (${pipeline.label}). ` +
        `Use tools, then send a verified customer status email via send_customer_email, then record_agent_outcome as resolved. ` +
        `No refunds, cancellations, credits, discounts, or address changes.`
      );
  }
}

export const PIPELINE_SYSTEM_RULES = `
ISSUE-TYPE PIPELINES (follow the order's issueType / customer notes, not just the user prompt):
- cancel_request → investigate → create_support_ticket → optional "under review" status email → request_human_approval(cancel_order) → awaiting_approval
- refund_request → investigate → create_support_ticket → request_human_approval(issue_refund) → awaiting_approval
- incorrect_address → investigate → create_support_ticket → request_human_approval(change_shipping_address) → awaiting_approval
- production_delay / missing_tracking / stale_tracking / delivery_status_inquiry → investigate → send_customer_email (direct customer answer) → record_agent_outcome(resolved)
- delivered_not_received → investigate → create_support_ticket → careful status email (no refund) → escalate_task
Restricted cases ALWAYS open an internal support ticket for the human reviewer.
Status cases: agent answers the customer directly after verified analysis — no approval needed.
Never resolve a cancel/refund/address/credit/discount/compensation case without request_human_approval.
Never ask the customer to "choose" cancel vs wait as a substitute for approval — escalate cancel to humans.
`.trim();
