"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clientCacheSet } from "@/lib/client/fetch-cache";
import { useClientCacheSnapshot } from "@/hooks/use-cached-json";
import { TableSkeleton } from "@/components/ui/table-skeleton";

type EvalData = {
  totalTests: number;
  cases: Array<{ code: string; title: string; category: string; expectedBehavior: string }>;
  latestRun: {
    id: string;
    passed: number;
    failed: number;
    totalTests: number;
    passRate: number;
    failureCategories: Record<string, number>;
    results: Array<{
      id: string;
      passed: boolean;
      actualBehavior: string;
      notes: string | null;
      evaluationCase: { code: string; title: string; category: string };
    }>;
  } | null;
  runs: Array<{ id: string; startedAt: string; passed: number; failed: number; totalTests: number }>;
};

export default function EvaluationsPage() {
  const cached = useClientCacheSnapshot<EvalData>("evaluations");
  const [data, setData] = useState<EvalData | null>(null);
  const [running, setRunning] = useState(false);
  const view = data ?? cached ?? null;

  async function load() {
    const res = await fetch("/api/evaluations");
    const json = await res.json();
    clientCacheSet("evaluations", json);
    setData(json);
  }

  useEffect(() => {
    void load();
  }, []);

  async function runSuite() {
    setRunning(true);
    toast.message("Running evaluation suite against the live agent…");
    try {
      const res = await fetch("/api/evaluations", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success(`Done: ${json.run.passed} passed, ${json.run.failed} failed`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppShell
      title="Evaluations"
      description="Run real agent tests against seeded scenarios. Results are computed — not hardcoded."
      actions={
        <Button
          onClick={runSuite}
          disabled={running}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          {running ? "Running suite…" : "Run evaluations"}
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        {!view ? (
          <div className="md:col-span-4">
            <TableSkeleton rows={2} cols={4} />
          </div>
        ) : null}
        <Stat label="Total tests" value={view?.totalTests ?? "—"} />
        <Stat
          label="Pass rate"
          value={
            view?.latestRun
              ? `${Math.round(view.latestRun.passRate * 100)}%`
              : "—"
          }
        />
        <Stat label="Passed (latest)" value={view?.latestRun?.passed ?? "—"} />
        <Stat label="Failed (latest)" value={view?.latestRun?.failed ?? "—"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Failure categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!view?.latestRun || Object.keys(view.latestRun.failureCategories).length === 0 ? (
              <p className="text-slate-500">No failures recorded (or no run yet).</p>
            ) : (
              Object.entries(view.latestRun.failureCategories).map(([cat, count]) => (
                <div key={cat} className="flex justify-between rounded border border-slate-100 px-3 py-2">
                  <span className="capitalize">{cat.replaceAll("_", " ")}</span>
                  <span>{count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent evaluation runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(view?.runs.length || 0) === 0 ? (
              <p className="text-slate-500">No runs yet.</p>
            ) : (
              view!.runs.map((r) => (
                <div key={r.id} className="rounded border border-slate-100 px-3 py-2">
                  {new Date(r.startedAt).toLocaleString()} · {r.passed}/{r.totalTests} passed
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Test cases & latest results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(view?.latestRun?.results || []).map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">
                  {r.evaluationCase.code}: {r.evaluationCase.title}
                </div>
                <StatusBadge status={r.passed ? "passed" : "failed"} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{r.notes}</p>
              <p className="mt-2 text-xs text-slate-600">{r.actualBehavior}</p>
            </div>
          ))}
          {!view?.latestRun ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">
                No results yet. Seeded cases ready to run:
              </p>
              {view?.cases.map((c) => (
                <div key={c.code} className="rounded border border-slate-100 px-3 py-2 text-sm">
                  <div className="font-medium">
                    {c.code}: {c.title}
                  </div>
                  <div className="text-xs text-slate-500">{c.expectedBehavior}</div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}
