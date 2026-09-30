type StepLike = {
  title: string;
  detail: string | null;
  toolName: string | null;
  toolInputJson: string | null;
  toolResultJson: string | null;
  stepType: string;
  status: string;
};

function safeJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function humanizeSummary(raw: string | null | undefined): string {
  if (!raw) return "No summary yet.";

  let text = raw
    .replace(/\*\*/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\r/g, "");

  // Drop very technical key=value dumps into plain language where possible.
  text = text
    .replace(/productionStatus\s*"?delayed"?/gi, "production is delayed")
    .replace(/order status\s*"?in_production"?/gi, "order is still in production")
    .replace(/shippingStatus\s*"?not_shipped"?/gi, "it has not shipped yet")
    .replace(/currentStage\s*"?print_queue"?/gi, "it is waiting in the print queue")
    .replace(/delayReason\s*"([^"]+)"/gi, "because of $1")
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.Z+-]+\b/g, (iso) => {
      try {
        return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
      } catch {
        return iso;
      }
    });

  // Prefer first meaningful paragraphs / bullets.
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0);

  const cleaned = lines
    .filter((l) => !/^out:\s*\{/.test(l) && !/^in:\s*\{/.test(l))
    .slice(0, 8)
    .join(" ");

  if (cleaned.length > 420) return `${cleaned.slice(0, 417).trim()}…`;
  return cleaned || text.slice(0, 420);
}

export function timelinePlainEnglish(step: StepLike): string {
  const result = safeJson(step.toolResultJson);
  const data = (result?.data as Record<string, unknown> | undefined) || undefined;
  const ok = result?.ok === true;

  switch (step.toolName) {
    case "get_order_details": {
      if (!ok || !data) return step.detail || "Looking up the order.";
      const order = data.order as Record<string, unknown> | undefined;
      return `Found order ${order?.orderNumber || ""}. Status: ${String(order?.orderStatus || "unknown").replaceAll("_", " ")}; shipping: ${String(order?.shippingStatus || "unknown").replaceAll("_", " ")}.`.trim();
    }
    case "get_production_status": {
      if (!ok || !data) return step.detail || "Checking production.";
      if (data.delayReported) {
        return `Production is delayed${data.delayReason ? ` — ${data.delayReason}` : ""}. Stage: ${String(data.currentStage || "").replaceAll("_", " ")}.`;
      }
      return `Production stage: ${String(data.currentStage || data.productionStatus || "unknown").replaceAll("_", " ")}.`;
    }
    case "track_shipment": {
      if (!ok || !data) return step.detail || "Checking shipment.";
      if (!data.trackingNumber) return "No tracking number on this order yet.";
      return `Shipment status: ${String(data.shipmentStatus || "unknown").replaceAll("_", " ")} via ${data.carrier || "carrier"}.`;
    }
    case "get_customer_history":
      return ok ? "Reviewed recent customer orders and support history." : step.detail || "Could not load customer history.";
    case "create_support_ticket": {
      if (!ok || !data) return step.detail || "Creating support ticket.";
      return `Created internal support ticket (${data.priority || "medium"} priority, ${String(data.category || "").replaceAll("_", " ")}). Status: ${data.status}.`;
    }
    case "draft_customer_email":
      return ok
        ? "Drafted a customer-facing email from verified findings only (not sent yet unless send tool ran)."
        : step.detail || "Drafting customer email.";
    case "send_customer_email":
      return ok
        ? "Stored a simulated outbound email (demo — no real email sent)."
        : step.detail || "Sending email.";
    case "request_human_approval":
      return ok ? "Paused for human approval on a restricted action." : step.detail || "Requesting approval.";
    case "escalate_task":
      return ok ? "Escalated to a human operator." : step.detail || "Escalating.";
    case "record_agent_outcome":
      return ok ? "Saved the investigation outcome." : step.detail || "Recording outcome.";
    default:
      if (step.stepType === "lifecycle") return step.detail || step.title;
      if (step.stepType === "decision") {
        if (step.title.includes("Investigation completed")) {
          return "Finished gathering evidence and prepared the final outcome.";
        }
        return step.detail || step.title;
      }
      return step.detail || step.title;
  }
}

export function extractDraftEmail(steps: StepLike[]): {
  to?: string;
  subject?: string;
  body?: string;
} | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.toolName !== "draft_customer_email" || !s.toolResultJson) continue;
    const parsed = safeJson(s.toolResultJson);
    if (!parsed?.ok) continue;
    const data = parsed.data as Record<string, unknown>;
    return {
      to: typeof data.to === "string" ? data.to : undefined,
      subject: typeof data.subject === "string" ? data.subject : undefined,
      body: typeof data.body === "string" ? data.body : undefined,
    };
  }
  return null;
}

export function extractCreatedTickets(steps: StepLike[]): Array<{
  ticketId: string;
  category?: string;
  priority?: string;
  status?: string;
}> {
  const tickets: Array<{
    ticketId: string;
    category?: string;
    priority?: string;
    status?: string;
  }> = [];
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.toolName !== "create_support_ticket" || !s.toolResultJson) continue;
    const parsed = safeJson(s.toolResultJson);
    if (!parsed?.ok) continue;
    const data = parsed.data as Record<string, unknown>;
    const ticketId = String(data.ticketId || "");
    if (!ticketId || seen.has(ticketId)) continue;
    seen.add(ticketId);
    tickets.push({
      ticketId,
      category: typeof data.category === "string" ? data.category : undefined,
      priority: typeof data.priority === "string" ? data.priority : undefined,
      status: typeof data.status === "string" ? data.status : undefined,
    });
  }
  return tickets;
}

/** Collapse tool_call + tool_result pairs into one display row. */
export function collapseTimelineSteps<T extends StepLike & { id: string; createdAt: string }>(
  steps: T[],
): Array<T & { plainEnglish: string }> {
  const collapsed: Array<T & { plainEnglish: string }> = [];
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const next = steps[i + 1];
    if (
      current.stepType === "tool_call" &&
      next &&
      next.stepType === "tool_result" &&
      next.toolName === current.toolName
    ) {
      const merged = {
        ...next,
        title: current.title.replace(/ — result$/, ""),
      };
      collapsed.push({ ...merged, plainEnglish: timelinePlainEnglish(merged) });
      i += 1;
      continue;
    }
    collapsed.push({ ...current, plainEnglish: timelinePlainEnglish(current) });
  }
  return collapsed;
}
