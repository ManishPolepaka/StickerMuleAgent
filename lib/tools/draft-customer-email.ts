import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { buildCustomerStatusEmail, humanizeCustomerText } from "@/lib/customer-copy";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  orderId: z.string().min(1),
  verifiedFindings: z.array(z.string()).min(1),
  intendedCommunication: z.string().min(1),
});

export const draftCustomerEmailTool: AgentTool = {
  name: "draft_customer_email",
  description:
    "Draft a professional, easy-to-read customer email from verified findings. Use plain language only — no snake_case statuses (e.g. not_shipped) and no raw ISO timestamps.",
  parameters: jsonSchemaFromZodShape(
    {
      orderId: { type: "string" },
      verifiedFindings: {
        type: "array",
        items: { type: "string" },
        description:
          "Plain-language findings for the customer (e.g. 'Your order has not shipped yet'). Never use technical codes or ISO timestamps.",
      },
      intendedCommunication: {
        type: "string",
        description: "Short plain-language closing note for the customer.",
      },
    },
    ["orderId", "verifiedFindings", "intendedCommunication"],
  ),
  schema,
  async execute(input) {
    const parsed = schema.parse(input);
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: parsed.orderId }, { id: parsed.orderId }] },
      include: { customer: true },
    });
    if (!order) return { ok: false, error: `Order not found: ${parsed.orderId}` };

    const { subject, body } = buildCustomerStatusEmail({
      customerName: order.customer.name,
      orderNumber: order.orderNumber,
      findings: parsed.verifiedFindings,
      closingNote: humanizeCustomerText(parsed.intendedCommunication),
    });

    return {
      ok: true,
      data: {
        to: order.customer.email,
        subject,
        body,
        orderNumber: order.orderNumber,
        draftOnly: true,
        note: "Draft only — not sent. Written in plain customer language.",
      },
    };
  },
};
