import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk, parseJson } from "@/lib/api";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        order: { include: { customer: true } },
        customer: true,
      },
    });
    if (!ticket) return jsonError("Ticket not found", 404);
    return jsonOk({ ticket });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load ticket", 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = updateSchema.parse(await parseJson(request));
    const ticket = await prisma.supportTicket.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
      },
      include: {
        order: { select: { orderNumber: true } },
        customer: { select: { name: true, email: true } },
      },
    });
    return jsonOk({ ticket });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to update ticket", 400);
  }
}
