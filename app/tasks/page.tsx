import { TasksClient } from "@/app/tasks/tasks-client";

/** Client-first: paints instantly from browser cache; no SSR wait on nav. */
export default function TasksPage() {
  return <TasksClient />;
}
