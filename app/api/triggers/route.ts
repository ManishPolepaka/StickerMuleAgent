import { z } from "zod";
import { jsonError, jsonOk, parseJson } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache/memory";
import { publishRealtime } from "@/lib/realtime/events";
import { getTriggersInbox } from "@/lib/services/triggers";
import {
  ingestCustomerMessage,
  ingestProductionDelay,
  ingestShippingWebhook,
  runBulkDelayedScan,
  runLateOrderScan,
  runSlaScan,
} from "@/lib/triggers/runners";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk(await getTriggersInbox());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load triggers", 500);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("customer_message"),
    channel: z.enum(["email", "chat", "ticket"]).default("email"),
    fromEmail: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
    orderNumber: z.string().optional().nullable(),
  }),
  z.object({
    action: z.literal("late_order_scan"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    action: z.literal("shipping_webhook"),
    orderNumber: z.string().min(1),
    status: z.string().min(1),
    eventLabel: z.string().min(1),
    location: z.string().optional(),
  }),
  z.object({
    action: z.literal("production_delay"),
    orderNumber: z.string().min(1),
    delayReason: z.string().min(1),
  }),
  z.object({
    action: z.literal("sla_scan"),
    hours: z.number().int().min(1).max(72).optional(),
  }),
  z.object({
    action: z.literal("bulk_scan"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const body = actionSchema.parse(await parseJson(request));

    const labels: Record<string, string> = {
      customer_message: "Routing customer message",
      late_order_scan: "Scanning late orders",
      shipping_webhook: "Routing shipping webhook",
      production_delay: "Routing production delay",
      sla_scan: "Scanning SLA breaches",
      bulk_scan: "Running bulk delay scan",
    };

    publishRealtime({
      type: "routing_started",
      action: body.action,
      label: labels[body.action] || "Routing event",
      detail:
        body.action === "customer_message"
          ? body.subject
          : "orderNumber" in body && body.orderNumber
            ? String(body.orderNumber)
            : undefined,
    });

    let result;
    switch (body.action) {
      case "customer_message":
        result = await ingestCustomerMessage({
          channel: body.channel,
          fromEmail: body.fromEmail,
          subject: body.subject,
          body: body.body,
          orderNumber: body.orderNumber,
        });
        break;
      case "late_order_scan":
        result = await runLateOrderScan(body.limit ?? 5);
        break;
      case "shipping_webhook":
        result = await ingestShippingWebhook(body);
        break;
      case "production_delay":
        result = await ingestProductionDelay(body);
        break;
      case "sla_scan":
        result = await runSlaScan(body.hours ?? 4);
        break;
      case "bulk_scan":
        result = await runBulkDelayedScan(body.limit ?? 8);
        break;
      default:
        return jsonError("Unknown action", 400);
    }
    cacheInvalidate("triggers:");
    cacheInvalidate("tasks:");
    cacheInvalidate("dashboard:");
    return jsonOk(result, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Trigger failed", 400);
  }
}
