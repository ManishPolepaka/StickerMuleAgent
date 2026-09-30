import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  orderId: z.string().min(1),
  issueCategory: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export const createSupportTicketTool: AgentTool = {
  name: "create_support_ticket",
  description: "Create an internal support ticket in the application database.",
  parameters: jsonSchemaFromZodShape(
    {
      orderId: { type: "string" },
      issueCategory: { type: "string" },
      description: { type: "string" },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
    },
    ["orderId", "issueCategory", "description"],
  ),
  schema,
  async execute(input) {
    const parsed = schema.parse(input);
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: parsed.orderId }, { id: parsed.orderId }] },
    });
    if (!order) return { ok: false, error: `Order not found: ${parsed.orderId}` };

    const ticket = await prisma.supportTicket.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        category: parsed.issueCategory,
        description: parsed.description,
        priority: parsed.priority,
        status: "open",
        createdBy: "order_operations_agent",
      },
    });

    return {
      ok: true,
      data: {
        ticketId: ticket.id,
        status: ticket.status,
        category: ticket.category,
        priority: ticket.priority,
      },
    };
  },
};
