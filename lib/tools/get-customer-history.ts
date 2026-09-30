import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  customerId: z.string().min(1),
});

export const getCustomerHistoryTool: AgentTool = {
  name: "get_customer_history",
  description:
    "Return previous orders, support interactions, and relevant notes needed for the current task.",
  parameters: jsonSchemaFromZodShape(
    {
      customerId: { type: "string", description: "Customer internal ID" },
    },
    ["customerId"],
  ),
  schema,
  async execute(input) {
    const { customerId } = schema.parse(input);
    const customer = await prisma.customer.findFirst({
      where: { OR: [{ id: customerId }, { externalId: customerId }] },
      include: {
        orders: {
          orderBy: { orderDate: "desc" },
          take: 5,
          select: {
            orderNumber: true,
            orderStatus: true,
            orderDate: true,
            orderValue: true,
            issueType: true,
          },
        },
        supportHistory: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    if (!customer) return { ok: false, error: `Customer not found: ${customerId}` };

    return {
      ok: true,
      data: {
        customerId: customer.id,
        externalId: customer.externalId,
        name: customer.name,
        notes: customer.notes,
        recentOrders: customer.orders,
        previousSupportInteractions: customer.supportHistory.map((s) => ({
          channel: s.channel,
          subject: s.subject,
          summary: s.summary,
          createdAt: s.createdAt,
        })),
      },
    };
  },
};
