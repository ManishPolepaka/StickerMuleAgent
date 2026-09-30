import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  orderId: z.string().min(1),
});

export const getOrderDetailsTool: AgentTool = {
  name: "get_order_details",
  description:
    "Retrieve order details, customer details, production/shipping status, expected delivery, and tracking info by order number or internal id.",
  parameters: jsonSchemaFromZodShape(
    {
      orderId: { type: "string", description: "Order number (e.g. ORD-1005) or internal ID" },
    },
    ["orderId"],
  ),
  schema,
  async execute(input) {
    const { orderId } = schema.parse(input);
    const order = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber: orderId }, { id: orderId }],
      },
      include: { customer: true },
    });

    if (!order) {
      return { ok: false, error: `Order not found: ${orderId}` };
    }

    return {
      ok: true,
      data: {
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          expectedDeliveryDate: order.expectedDeliveryDate,
          orderStatus: order.orderStatus,
          productionStatus: order.productionStatus,
          shippingStatus: order.shippingStatus,
          trackingNumber: order.trackingNumber,
          shippingCarrier: order.shippingCarrier,
          shippingAddress: order.shippingAddress,
          orderValue: order.orderValue,
          customerNotes: order.customerNotes,
          issueType: order.issueType,
        },
        customer: {
          id: order.customer.id,
          externalId: order.customer.externalId,
          name: order.customer.name,
          email: order.customer.email,
          notes: order.customer.notes,
        },
        source: "demo_database",
      },
    };
  },
};
