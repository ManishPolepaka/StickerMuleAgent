export const RESTRICTED_ACTIONS = [
  "issue_refund",
  "issue_credit",
  "issue_discount",
  "cancel_order",
  "change_shipping_address",
  "promise_compensation",
] as const;

export type RestrictedAction = (typeof RESTRICTED_ACTIONS)[number];

export const AUTO_ALLOWED_ACTIONS = [
  "read_order",
  "read_production",
  "read_shipping",
  "read_customer_history",
  "create_investigation_record",
  "draft_customer_email",
  "send_customer_email",
  "create_support_ticket",
  "escalate_task",
  "send_simulated_email",
  "record_outcome",
] as const;

export function isRestrictedAction(action: string): boolean {
  const normalized = action.toLowerCase().replace(/\s+/g, "_");
  return RESTRICTED_ACTIONS.some(
    (r) => normalized.includes(r) || normalized.includes(r.replace(/_/g, "")),
  );
}

export type DemoRole = "admin" | "operator" | "viewer";

export function getDemoRole(): DemoRole {
  const role = (process.env.DEMO_ADMIN_ROLE || "admin").toLowerCase();
  if (role === "operator" || role === "viewer") return role;
  return "admin";
}

export function assertCanApprove(role: DemoRole = getDemoRole()) {
  if (role === "viewer") {
    throw new Error("Viewers cannot approve or reject actions.");
  }
}

export function assertCanRunAgent(role: DemoRole = getDemoRole()) {
  if (role === "viewer") {
    throw new Error("Viewers cannot start investigations.");
  }
}

export function assertCanUpdateSettings(role: DemoRole = getDemoRole()) {
  if (role !== "admin") {
    throw new Error("Only administrators can update agent settings.");
  }
}
