/**
 * Mark stuck "running" tasks/executions as failed so the UI unblocks.
 * Usage: npx tsx scripts/fail-stuck-running.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const running = await prisma.agentTask.findMany({
    where: { status: "running" },
    select: { id: true, taskNumber: true },
  });

  if (running.length === 0) {
    console.log("No running tasks.");
    return;
  }

  const ids = running.map((t) => t.id);
  const tasks = await prisma.agentTask.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "failed",
      actionResult:
        "Marked failed: investigation hung (DB connection pool exhausted). Re-run after raising connection_limit.",
      completedAt: new Date(),
    },
  });
  const execs = await prisma.agentExecution.updateMany({
    where: { taskId: { in: ids }, status: "running" },
    data: {
      status: "failed",
      errorMessage: "Connection pool timeout / hung run",
      completedAt: new Date(),
    },
  });

  console.log(
    `Failed ${tasks.count} task(s), ${execs.count} execution(s):`,
    running.map((t) => t.taskNumber).join(", "),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
