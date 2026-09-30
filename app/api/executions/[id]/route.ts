import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const execution = await prisma.agentExecution.findUnique({
      where: { id },
      include: {
        task: { include: { order: { include: { customer: true } }, approvals: true } },
        steps: { orderBy: { stepIndex: "asc" } },
        approvals: true,
      },
    });
    if (!execution) return jsonError("Execution not found", 404);

    // Redact unnecessary PII from log payload for UI.
    const safe = {
      ...execution,
      task: execution.task
        ? {
            ...execution.task,
            order: execution.task.order
              ? {
                  ...execution.task.order,
                  customer: execution.task.order.customer
                    ? {
                        id: execution.task.order.customer.id,
                        externalId: execution.task.order.customer.externalId,
                        name: execution.task.order.customer.name,
                        email: execution.task.order.customer.email.replace(
                          /(?<=.).(?=.*@)/g,
                          "*",
                        ),
                      }
                    : null,
                }
              : null,
          }
        : null,
    };

    return jsonOk({ execution: safe });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load execution", 500);
  }
}
