import { notFound } from "next/navigation";
import { TaskDetailClient } from "@/app/tasks/[id]/task-detail-client";

/** Client-first shell — detail loads in the browser so list→detail isn’t blocked on SSR. */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id) notFound();
  return <TaskDetailClient taskId={id} />;
}
