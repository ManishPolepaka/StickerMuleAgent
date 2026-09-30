"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { GlobalTopBar } from "@/components/layout/global-notifications";
import { NavPendingProvider, NavProgressBar } from "@/components/layout/nav-pending";

/** Persistent chrome so the sidebar does not remount on every route change. */
export function DashboardFrame({ children }: { children: React.ReactNode }) {
  return (
    <NavPendingProvider>
      <div className="flex min-h-screen bg-[#f1f5f9] text-slate-900">
        <AppSidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <GlobalTopBar />
          <NavProgressBar />
          {children}
        </div>
      </div>
    </NavPendingProvider>
  );
}
