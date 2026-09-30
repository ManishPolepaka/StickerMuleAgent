/** Customer-facing copy helpers — plain language, no snake_case or ISO timestamps. */

const STATUS_PHRASES: Record<string, string> = {
  not_shipped: "has not shipped yet",
  in_production: "is still in production",
  in_progress: "is in progress",
  delayed: "is delayed",
  print_queue: "is waiting in the print queue",
  queued: "is queued",
  completed: "is complete",
  shipped: "has shipped",
  in_transit: "is in transit",
  out_for_delivery: "is out for delivery",
  delivered: "was delivered",
  exception: "has a shipping exception",
  returned: "was returned",
  undeliverable: "could not be delivered",
  cancelled: "was cancelled",
  canceled: "was canceled",
  pending: "is pending",
  on_hold: "is on hold",
  material_shortage: "a material shortage",
  missing_tracking: "tracking is not available yet",
  stale_tracking: "tracking has not updated recently",
  production_delay: "a production delay",
};

function formatFriendlyDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

/** Turn snake_case / status tokens into short readable phrases. */
export function humanizeLabel(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (STATUS_PHRASES[key]) return STATUS_PHRASES[key];
  return raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Rewrite agent/tool jargon for customer emails:
 * - ISO timestamps → "October 4, 2026"
 * - snake_case statuses → plain phrases
 * - field dumps like shippingStatus "not_shipped" → readable sentences
 */
export function humanizeCustomerText(raw: string): string {
  if (!raw) return "";

  let text = raw
    .replace(/\*\*/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\r/g, "");

  // Field-style dumps from tools / model
  text = text
    .replace(/productionStatus\s*[:=]?\s*"?delayed"?/gi, "production is delayed")
    .replace(/productionStatus\s*[:=]?\s*"?([a-z0-9_]+)"?/gi, (_, s: string) => `production ${humanizeLabel(s)}`)
    .replace(/shippingStatus\s*[:=]?\s*"?not_shipped"?/gi, "the order has not shipped yet")
    .replace(/shippingStatus\s*[:=]?\s*"?([a-z0-9_]+)"?/gi, (_, s: string) => `shipping status: ${humanizeLabel(s)}`)
    .replace(/orderStatus\s*[:=]?\s*"?([a-z0-9_]+)"?/gi, (_, s: string) => `order ${humanizeLabel(s)}`)
    .replace(/shipmentStatus\s*[:=]?\s*"?([a-z0-9_]+)"?/gi, (_, s: string) => `shipment ${humanizeLabel(s)}`)
    .replace(/currentStage\s*[:=]?\s*"?([a-z0-9_]+)"?/gi, (_, s: string) => `current stage: ${humanizeLabel(s)}`)
    .replace(/delayReason\s*[:=]?\s*"([^"]+)"/gi, "because of $1")
    .replace(/delayReason\s*[:=]?\s*([a-z0-9_]+)/gi, (_, s: string) => `because of ${humanizeLabel(s)}`);

  // Bare ISO timestamps → friendly dates (no clock time)
  text = text.replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?\b/g, (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : formatFriendlyDate(d);
  });

  // Date-only ISO
  text = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (ymd) => {
    const d = new Date(`${ymd}T12:00:00`);
    return Number.isNaN(d.getTime()) ? ymd : formatFriendlyDate(d);
  });

  // Standalone snake_case status tokens common in findings
  text = text.replace(
    /\b(not_shipped|in_production|in_progress|print_queue|in_transit|out_for_delivery|on_hold|missing_tracking|stale_tracking|production_delay|material_shortage)\b/gi,
    (m) => humanizeLabel(m),
  );

  // Remaining snake_case words (2+ segments) → spaced words
  text = text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi, (m) => m.replace(/_/g, " "));

  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildCustomerStatusEmail(input: {
  customerName: string;
  orderNumber: string;
  findings: string[];
  closingNote?: string;
}): { subject: string; body: string } {
  const findings = input.findings
    .map((f) => humanizeCustomerText(f))
    .map((f) => f.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .map((f) => {
      // Capitalize first letter for bullets
      const line = f.charAt(0).toUpperCase() + f.slice(1);
      return line.endsWith(".") ? line : `${line}.`;
    });

  const unique = [...new Set(findings)];
  const bullets =
    unique.length > 0
      ? unique.map((f) => `• ${f}`).join("\n")
      : "• We reviewed your order and confirmed the latest available status.";

  const closing = humanizeCustomerText(
    input.closingNote ||
      "We are continuing to monitor this and will follow up if anything meaningful changes.",
  );

  const subject = `Update on your order ${input.orderNumber}`;
  const body = `Hi ${input.customerName},

Thank you for checking in on order ${input.orderNumber}.

Here is what we can confirm right now:
${bullets}

${closing}

We will not promise specific delivery dates, refunds, or credits unless they have been confirmed by our team. If you have more details that could help, just reply to this message.

Thank you for your patience,
CommerceOps Support
`;

  return { subject, body };
}
