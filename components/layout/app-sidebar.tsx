"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  ChevronRight,
  ClipboardCheck,
  LayoutDashboard,
  Package,
  Settings,
  Users,
  ListChecks,
  Zap,
  Ticket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { prefetchPageData, warmAllPageData } from "@/lib/client/fetch-cache";
import { useNavPending } from "@/components/layout/nav-pending";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/agents", label: "AI Agents", icon: Bot },
  { href: "/tasks", label: "Tasks & Investigations", icon: ListChecks },
  { href: "/triggers", label: "Triggers & Inbox", icon: Zap, badgeKey: "triggers" as const },
  { href: "/tickets", label: "Support Tickets", icon: Ticket },
  { href: "/orders", label: "Orders", icon: Package },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/logs", label: "Agent Activity Logs", icon: Activity },
  { href: "/evaluations", label: "Evaluations", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

function pathMatches(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { pendingHref, setPendingHref } = useNavPending();
  const [triggerCount, setTriggerCount] = useState<number | null>(null);

  // Prefetch routes + API payloads immediately so first clicks after refresh are warm.
  useEffect(() => {
    for (const item of nav) router.prefetch(item.href);
    warmAllPageData();
    const idle =
      "requestIdleCallback" in window
        ? window.requestIdleCallback(() => warmAllPageData(), { timeout: 1500 })
        : window.setTimeout(() => warmAllPageData(), 400);
    return () => {
      if (typeof idle === "number" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idle as number);
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, [router]);

  useEffect(() => {
    let alive = true;
    fetch("/api/triggers")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const n = (d.messages || []).filter(
          (m: { status: string }) => m.status === "new" || m.status === "routed",
        ).length;
        setTriggerCount(n || (d.triggers || []).length || null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pathname]);

  return (
    <aside className="sticky top-0 z-20 flex h-screen w-[260px] shrink-0 flex-col border-r border-slate-200/80 bg-white">
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-500 text-sm font-bold text-white shadow-lg shadow-blue-600/25">
            A
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold tracking-[0.08em] text-slate-900">
              COMMERCEOPS AI
            </div>
            <p className="truncate text-xs text-slate-500">Autonomous commerce operations</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-3 py-2 text-[11px] font-medium text-amber-900">
          <span>Demo platform</span>
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {nav.map((item) => {
          const routeActive = pathMatches(pathname, item.href);
          const pendingActive = pendingHref ? pathMatches(pendingHref, item.href) : false;
          const active = pendingHref ? pendingActive : routeActive;
          const Icon = item.icon;
          const badge =
            item.badgeKey === "triggers" && triggerCount && triggerCount > 0
              ? Math.min(triggerCount, 99)
              : null;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onMouseEnter={() => {
                router.prefetch(item.href);
                prefetchPageData(item.href);
              }}
              onFocus={() => {
                router.prefetch(item.href);
                prefetchPageData(item.href);
              }}
              onClick={() => {
                // Kick data fetch before the route transition so the page can paint from cache.
                prefetchPageData(item.href);
                if (!routeActive) setPendingHref(item.href);
              }}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                active
                  ? "bg-blue-50 text-blue-700 shadow-sm shadow-blue-100"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                pendingActive && !routeActive && "ring-1 ring-blue-200/80",
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px] transition-colors",
                  active ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600",
                )}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {pendingActive && !routeActive ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              ) : badge ? (
                <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 p-4">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            N
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">Demo admin</div>
            <div className="truncate text-[11px] text-slate-500">role-aware APIs</div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </aside>
  );
}
