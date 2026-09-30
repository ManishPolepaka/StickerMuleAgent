import { warmDashboardMetrics } from "@/lib/services/metrics";
import { warmTasksList } from "@/lib/services/tasks";
import { warmTriggersInbox } from "@/lib/services/triggers";
import {
  warmCustomersList,
  warmExecutionsList,
  warmOrdersList,
  warmTicketsList,
} from "@/lib/services/lists";

/**
 * Local-dev cache warm only. On Netlify/serverless, warming every list in parallel
 * on cold start storms the DB pool and causes 502/504 on /api/*.
 */
export async function register() {
  if (process.env.NETLIFY || process.env.CONTEXT || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }

  void Promise.all([
    warmDashboardMetrics(),
    warmTasksList(),
    warmTriggersInbox(),
    warmOrdersList(),
    warmCustomersList(),
    warmExecutionsList(),
    warmTicketsList(),
  ]).catch((err) => {
    console.warn("Cache warm-up skipped:", err instanceof Error ? err.message : err);
  });
}
