import { warmDashboardMetrics } from "@/lib/services/metrics";
import { warmTasksList } from "@/lib/services/tasks";
import { warmTriggersInbox } from "@/lib/services/triggers";
import {
  warmCustomersList,
  warmExecutionsList,
  warmOrdersList,
  warmTicketsList,
} from "@/lib/services/lists";

export async function register() {
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
