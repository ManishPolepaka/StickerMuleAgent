import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  passed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  routed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  agent_started: "bg-sky-50 text-sky-700 ring-sky-200",
  running: "bg-sky-50 text-sky-700 ring-sky-200",
  in_progress: "bg-sky-50 text-sky-700 ring-sky-200",
  pending: "bg-slate-100 text-slate-600 ring-slate-200",
  awaiting_approval: "bg-amber-50 text-amber-700 ring-amber-200",
  needs_human: "bg-orange-50 text-orange-700 ring-orange-200",
  escalated: "bg-rose-50 text-rose-700 ring-rose-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
  skipped: "bg-slate-100 text-slate-500 ring-slate-200",
  ignored: "bg-slate-100 text-slate-500 ring-slate-200",
  open: "bg-blue-50 text-blue-700 ring-blue-200",
  new: "bg-blue-50 text-blue-700 ring-blue-200",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full border-0 px-2.5 py-0.5 text-[11px] font-semibold capitalize ring-1",
        STATUS_STYLES[s] || "bg-slate-100 text-slate-600 ring-slate-200",
      )}
    >
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
