import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  orderId: z.string().min(1),
});

export const getProductionStatusTool: AgentTool = {
  name: "get_production_status",
  description:
    "Get simulated production stage, start time, estimated completion, and reported delays for an order.",
  parameters: jsonSchemaFromZodShape(
    {
      orderId: { type: "string", description: "Order number or ID" },
    },
    ["orderId"],
  ),
  schema,
  async execute(input) {
    const { orderId } = schema.parse(input);
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: orderId }, { id: orderId }] },
      include: { productionRecords: { orderBy: { updatedAt: "desc" }, take: 1 } },
    });

    if (!order) return { ok: false, error: `Order not found: ${orderId}` };

    const record = order.productionRecords[0];
    return {
      ok: true,
      data: {
        orderNumber: order.orderNumber,
        productionStatus: order.productionStatus,
        currentStage: record?.stage ?? order.productionStatus,
        productionStartTime: record?.startedAt ?? null,
        estimatedCompletionTime: record?.estimatedCompletionAt ?? null,
        delayReported: record?.delayReported ?? false,
        delayReason: record?.delayReason ?? null,
        notes: record?.notes ?? null,
        integration: "simulated_production_system",
      },
    };
  },
};
