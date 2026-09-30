import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { humanizeCustomerText } from "@/lib/customer-copy";
import type { AgentTool } from "./types";
import { jsonSchemaFromZodShape } from "./types";

const schema = z.object({
  customerEmail: z.string().email(),
  subject: z.string().min(1),
  message: z.string().min(1),
  relatedOrderId: z.string().min(1),
});

export const sendCustomerEmailTool: AgentTool = {
  name: "send_customer_email",
  description:
    "Send a verified customer status/update email via the simulated provider (auto-allowed — no human approval). Message must be plain customer language. Does not send real SMTP mail.",
  parameters: jsonSchemaFromZodShape(
    {
      customerEmail: { type: "string" },
      subject: { type: "string" },
      message: { type: "string" },
      relatedOrderId: { type: "string" },
    },
    ["customerEmail", "subject", "message", "relatedOrderId"],
  ),
  schema,
  async execute(input, ctx) {
    const parsed = schema.parse(input);
    const order = await prisma.order.findFirst({
      where: { OR: [{ orderNumber: parsed.relatedOrderId }, { id: parsed.relatedOrderId }] },
    });

    const subject = humanizeCustomerText(parsed.subject);
    const body = humanizeCustomerText(parsed.message);

    const email = await prisma.simulatedEmail.create({
      data: {
        taskId: ctx.taskId,
        orderId: order?.id,
        toEmail: parsed.customerEmail,
        subject: `[SIMULATED] ${subject}`,
        body,
        status: "simulated_sent",
        provider: "simulated_email_provider",
      },
    });

    return {
      ok: true,
      data: {
        emailId: email.id,
        deliveryResult: "simulated_accepted",
        provider: "simulated_email_provider",
        labeled: "SIMULATED — no real email was sent",
      },
    };
  },
};
