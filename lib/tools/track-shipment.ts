import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  trackingNumber: z.string().optional(),
  orderId: z.string().optional(),
}).refine((v) => v.trackingNumber || v.orderId, {
  message: "Provide trackingNumber or orderId",
});

export const trackShipmentTool: AgentTool = {
  name: "track_shipment",
  description:
    "Track a shipment using tracking number or order ID via the simulated shipping integration.",
  parameters: jsonSchemaFromZodShape(
    {
      trackingNumber: { type: "string", description: "Carrier tracking number" },
      orderId: { type: "string", description: "Order number or ID" },
    },
    [],
  ),
  schema,
  async execute(input) {
    const parsed = schema.parse(input);
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          parsed.orderId ? { orderNumber: parsed.orderId } : undefined,
          parsed.orderId ? { id: parsed.orderId } : undefined,
          parsed.trackingNumber ? { trackingNumber: parsed.trackingNumber } : undefined,
        ].filter(Boolean) as Array<{ orderNumber?: string; id?: string; trackingNumber?: string }>,
      },
      include: { shipmentEvents: { orderBy: { eventAt: "desc" } } },
    });

    if (!order) {
      return { ok: false, error: "Shipment / order not found in simulated shipping system." };
    }

    if (!order.trackingNumber && !parsed.trackingNumber) {
      return {
        ok: true,
        data: {
          orderNumber: order.orderNumber,
          carrier: order.shippingCarrier,
          trackingNumber: null,
          shipmentStatus: order.shippingStatus,
          latestTrackingEvent: null,
          estimatedDeliveryDate: order.expectedDeliveryDate,
          note: "Missing tracking number on this order.",
          integration: "simulated_shipping_carrier",
        },
      };
    }

    const latest = order.shipmentEvents[0] ?? null;
    return {
      ok: true,
      data: {
        orderNumber: order.orderNumber,
        carrier: order.shippingCarrier ?? latest?.carrier ?? null,
        trackingNumber: order.trackingNumber,
        shipmentStatus: latest?.status ?? order.shippingStatus,
        latestTrackingEvent: latest
          ? {
              label: latest.eventLabel,
              status: latest.status,
              location: latest.location,
              eventAt: latest.eventAt,
            }
          : null,
        events: order.shipmentEvents.map((e) => ({
          label: e.eventLabel,
          status: e.status,
          location: e.location,
          eventAt: e.eventAt,
        })),
        estimatedDeliveryDate: latest?.estimatedDelivery ?? order.expectedDeliveryDate,
        integration: "simulated_shipping_carrier",
      },
    };
  },
};
