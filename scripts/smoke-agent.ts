import { runInvestigationSync } from "../lib/agent/runtime";

async function main() {
  const r = await runInvestigationSync({
    orderId: "ORD-1000",
    prompt:
      "Investigate why order ORD-1000 has not been delivered and determine what should happen next.",
  });
  console.log(
    JSON.stringify(
      {
        taskStatus: r.task?.status,
        tools: r.task?.executions?.[0]?.steps
          ?.filter((s) => s.toolName)
          .map((s) => s.toolName),
        summary: r.task?.investigationSummary,
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
