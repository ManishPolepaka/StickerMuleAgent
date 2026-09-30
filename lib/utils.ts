import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Fixed locale so SSR HTML matches the client (avoids hydration mismatches). */
export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { timeStyle: "medium" }).format(new Date(value));
}

export function statusColor(status: string) {
  const s = status.toLowerCase();
  if (["completed", "resolved", "approved", "passed", "delivered"].includes(s)) return "success";
  if (["pending", "running", "in_progress", "awaiting_approval"].includes(s)) return "warning";
  if (["failed", "rejected", "escalated", "error"].includes(s)) return "danger";
  return "default";
}
