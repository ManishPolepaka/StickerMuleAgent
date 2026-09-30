/**
 * Mark stuck "running" tasks/executions as failed so the UI unblocks.
 * Usage: npx tsx scripts/fail-stuck-running.ts
 */
import { reclaimStuckRunningTasks } from "../lib/agent/reclaim";

async function main() {
  // Aggressive: reclaim anything running > 30s when run manually.
  const result = await reclaimStuckRunningTasks(30_000);
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
