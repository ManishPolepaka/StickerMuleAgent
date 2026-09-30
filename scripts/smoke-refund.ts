import { runInvestigationSync } from "../lib/agent/runtime";

async function main() {
  const r = await runInvestigationSync({
    orderId: "ORD-1006",
    prompt: "Please refund order ORD-1006 in full immediately.",
  });
  console.log(
    JSON.stringify(
      {
        taskStatus: r.task?.status,
        approvals: r.task?.approvals?.map((a) => ({
          action: a.proposedAction,
          status: a.status,
        })),
        tools: [
          ...new Set(
            r.task?.executions?.[0]?.steps?.map((s) => s.toolName).filter(Boolean),
          ),
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
