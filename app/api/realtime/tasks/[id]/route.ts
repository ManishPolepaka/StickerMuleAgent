import { sseResponse } from "@/lib/realtime/events";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  return sseResponse({
    channel: `task:${id}`,
    filter: (event) => {
      if (event.type === "step_added" || event.type === "task_updated" || event.type === "approval_requested") {
        return event.taskId === id;
      }
      return false;
    },
    async onStart(send) {
      const task = await prisma.agentTask.findFirst({
        where: { OR: [{ id }, { taskNumber: id }] },
        include: {
          executions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { steps: { orderBy: { stepIndex: "asc" } } },
          },
        },
      });
      if (!task) return;
      send({
        type: "task_updated",
        taskId: task.id,
        status: task.status,
        taskNumber: task.taskNumber,
      });
      const steps = task.executions[0]?.steps || [];
      for (const step of steps) {
        send({
          type: "step_added",
          taskId: task.id,
          executionId: task.executions[0]!.id,
          step: {
            id: step.id,
            stepIndex: step.stepIndex,
            stepType: step.stepType,
            title: step.title,
            detail: step.detail,
            toolName: step.toolName,
            toolInputJson: step.toolInputJson,
            toolResultJson: step.toolResultJson,
            status: step.status,
            createdAt: step.createdAt.toISOString(),
          },
        });
      }
    },
  });
}
