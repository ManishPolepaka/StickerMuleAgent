"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Box,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MoreHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { RunInvestigationButton } from "@/components/run-investigation-button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Donut3D } from "@/components/charts/donut-3d";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { useEventSource } from "@/hooks/use-event-source";
import { useCachedJson } from "@/hooks/use-cached-json";
import { clientCacheInvalidate, clientCacheSet } from "@/lib/client/fetch-cache";
import { fetchJson } from "@/lib/client/fetch-json";
import type { DashboardMetrics } from "@/lib/services/metrics";
import { TableSkeleton } from "@/components/ui/table-skeleton";

type RangeKey = "7D" | "30D" | "90D" | "1Y";

function MiniSpark({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#spark-${color})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendPill({ value }: { value: number }) {
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        flat
          ? "bg-slate-100 text-slate-500"
          : up
            ? "bg-emerald-50 text-emerald-700"
            : "bg-rose-50 text-rose-700"
      }`}
    >
      {flat ? "0%" : `${up ? "+" : ""}${value}%`}
    </span>
  );
}

function KpiCard({
  label,
  value,
  trend,
  spark,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  trend: number;
  spark: number[];
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-0" size="sm">
      <CardContent className="py-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium leading-tight text-slate-500">
              {label}
            </div>
            <div className="mt-1 flex items-end gap-1.5">
              <div className="text-xl font-semibold tracking-tight text-slate-900">{value}</div>
              <TrendPill value={trend} />
            </div>
          </div>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md [&_svg]:h-4 [&_svg]:w-4"
            style={{
              background: `linear-gradient(135deg, ${color}, ${color}cc)`,
              boxShadow: `0 8px 16px ${color}33`,
            }}
          >
            {icon}
          </div>
        </div>
        <div className="mt-1.5 flex justify-end">
          <MiniSpark values={spark} color={color} />
        </div>
      </CardContent>
    </Card>
  );
}

const selectDashboard = (json: unknown) => json as DashboardMetrics;

export function OverviewClient({ initialData }: { initialData?: DashboardMetrics } = {}) {
  const {
    data,
    setData,
    error,
    loading,
    reload: loadDashboard,
  } = useCachedJson("dashboard:metrics", "/api/dashboard", selectDashboard, initialData);
  const [live, setLive] = useState("Live · Agents running");
  const [range, setRange] = useState<RangeKey>("7D");

  useEventSource("/api/realtime/stream", (event) => {
    if (event.type === "connected") {
      setLive("Live · Agents running");
      return;
    }
    if (
      event.type === "dashboard_changed" ||
      event.type === "task_updated" ||
      event.type === "trigger_processed"
    ) {
      setLive(`Live · ${new Date().toLocaleTimeString()}`);
      clientCacheInvalidate("dashboard:");
      void fetchJson<DashboardMetrics>("/api/dashboard?fresh=1", { retries: 2 })
        .then((json) => {
          const next = selectDashboard(json);
          clientCacheSet("dashboard:metrics", next);
          setData(next);
        })
        .catch(() => loadDashboard());
    }
  });

  // While any investigation is open/running, refresh overview so badges don't stick on Running.
  const hasOpenRunning = Boolean(
    data?.openInvestigations?.some((t) => t.status === "running" || t.status === "pending"),
  );
  useEffect(() => {
    if (!hasOpenRunning) return;
    const id = window.setInterval(() => {
      void fetchJson<DashboardMetrics>("/api/dashboard?fresh=1", { retries: 2 })
        .then((json) => {
          const next = selectDashboard(json);
          clientCacheSet("dashboard:metrics", next);
          setData(next);
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [hasOpenRunning, setData]);

  const volumeSlice = useMemo(() => {
    if (!data) return [];
    const n = range === "7D" ? 7 : range === "30D" ? 30 : range === "90D" ? 90 : 365;
    return data.charts.volumeOverTime.slice(-n);
  }, [data, range]);

  if (!data) {
    return (
      <AppShell
        title="Overview"
        description="Live operational metrics calculated from stored agent tasks and executions."
      >
        {error ? (
          <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-white" />
              ))}
            </div>
            <TableSkeleton rows={8} cols={4} />
          </div>
        )}
      </AppShell>
    );
  }

  const successTotal =
    data.charts.successVsFailed.successful +
    (data.charts.successVsFailed.pending || 0) +
    data.charts.successVsFailed.failed;

  const todayLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  const trends = data.kpis.trends || {
    ordersProcessed: 0,
    resolved: 0,
    human: 0,
    resolutionTime: 0,
    timeSaved: 0,
  };
  const sparks = data.kpis.sparks || {
    ordersProcessed: [0, 1, 0, 2, 1, 3, 2],
    resolved: [0, 0, 1, 0, 0, 1, 0],
    human: [0, 1, 1, 2, 1, 2, 2],
    resolutionTime: [90, 80, 70, 75, 60, 55, 50],
    timeSaved: [0, 0, 12, 12, 24, 24, 36],
  };

  const maxIssue = Math.max(
    1,
    ...data.charts.issueDistribution.map((d) => d.count),
  );

  return (
    <AppShell
      title="Overview"
      description="Live operational metrics calculated from stored agent tasks and executions."
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            {todayLabel}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {live}
          </div>
          <RunInvestigationButton />
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Orders processed by agents"
          value={data.kpis.ordersProcessedByAgents}
          trend={trends.ordersProcessed}
          spark={sparks.ordersProcessed}
          color="#2563eb"
          icon={<Box className="h-5 w-5" />}
        />
        <KpiCard
          label="Tasks successfully resolved"
          value={data.kpis.tasksSuccessfullyResolved}
          trend={trends.resolved}
          spark={sparks.resolved}
          color="#10b981"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <KpiCard
          label="Requiring human intervention"
          value={data.kpis.tasksRequiringHumanIntervention}
          trend={trends.human}
          spark={sparks.human}
          color="#f97316"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <KpiCard
          label="Avg resolution time"
          value={formatDuration(data.kpis.averageResolutionTimeMs)}
          trend={trends.resolutionTime}
          spark={sparks.resolutionTime}
          color="#8b5cf6"
          icon={<Clock3 className="h-5 w-5" />}
        />
        <KpiCard
          label="Est. time saved"
          value={`${data.kpis.estimatedOperationalTimeSavedMinutes} min`}
          trend={trends.timeSaved}
          spark={sparks.timeSaved}
          color="#0ea5e9"
          icon={<Zap className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="border-0 xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Agent task volume over time</CardTitle>
              <p className="mt-1 text-xs text-slate-500">Total · Resolved · Human intervention</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
              {(["7D", "30D", "90D", "1Y"] as RangeKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRange(key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    range === key
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="h-72">
            {volumeSlice.length === 0 ? (
              <EmptyChart text="No executions yet. Run an investigation to populate this chart." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeSlice}>
                  <defs>
                    <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gResolved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gHuman" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
                        new Date(v),
                      )
                    }
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 16,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 12px 30px rgba(15,23,42,0.08)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total tasks"
                    stroke="#2563eb"
                    fill="url(#gTotal)"
                    strokeWidth={2.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="resolved"
                    name="Resolved"
                    stroke="#10b981"
                    fill="url(#gResolved)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="human"
                    name="Human intervention"
                    stroke="#f97316"
                    fill="url(#gHuman)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Task outcomes</CardTitle>
            <MoreHorizontal className="h-4 w-4 text-slate-300" />
          </CardHeader>
          <CardContent className="h-72">
            {successTotal === 0 ? (
              <EmptyChart text="No task outcome data yet." />
            ) : (
              <Donut3D
                successful={data.charts.successVsFailed.successful}
                pending={data.charts.successVsFailed.pending || 0}
                failed={data.charts.successVsFailed.failed}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="border-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Tasks by issue type</CardTitle>
            <MoreHorizontal className="h-4 w-4 text-slate-300" />
          </CardHeader>
          <CardContent className="space-y-4">
            {data.charts.issueDistribution.map((row) => (
              <div key={row.issueType}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{row.issueType}</span>
                  <span className="text-slate-500">{row.count}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-sky-400"
                    style={{ width: `${Math.max(6, (row.count / maxIssue) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent agent activity</CardTitle>
            <MoreHorizontal className="h-4 w-4 text-slate-300" />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-slate-500">No activity yet.</p>
            ) : (
              data.recentActivity.map((a) => (
                <Link
                  key={a.id}
                  href={`/tasks/${a.taskId}`}
                  className="flex items-start gap-3 rounded-xl border border-slate-100 px-3 py-2.5 transition hover:border-blue-100 hover:bg-blue-50/40"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{a.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {a.taskNumber} · {formatDateTime(a.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={a.status || "running"} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Open investigations</CardTitle>
            <MoreHorizontal className="h-4 w-4 text-slate-300" />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.openInvestigations.length === 0 ? (
              <p className="text-sm text-slate-500">No open investigations.</p>
            ) : (
              data.openInvestigations.map((t) => (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5 transition hover:border-blue-100 hover:bg-blue-50/40"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{t.taskNumber}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {t.order?.orderNumber || "No order"} ·{" "}
                      {(t.issueType || "general").replaceAll("_", " ")}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
