"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";

export default function ExecutionDetailPage() {
  const params = useParams<{ id: string }>();
  const [execution, setExecution] = useState<{
    id: string;
    agentName: string;
    modelProvider: string;
    modelName: string;
    inputSummary: string | null;
    outputSummary: string | null;
    status: string;
    errorMessage: string | null;
    durationMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    steps: Array<{
      id: string;
      stepIndex: number;
      stepType: string;
      title: string;
      detail: string | null;
      toolName: string | null;
      toolInputJson: string | null;
      toolResultJson: string | null;
      status: string;
    }>;
    approvals: Array<{ proposedAction: string; status: string; reason: string }>;
    task: { taskNumber: string; prompt: string } | null;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/executions/${params.id}`)
      .then((r) => r.json())
      .then((d) => setExecution(d.execution));
  }, [params.id]);

  return (
    <AppShell
      title={execution ? `Execution · ${execution.task?.taskNumber}` : "Execution"}
      description="Full audit trail of model steps, tool I/O, approvals, and outcome."
    >
      {!execution ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Summary</CardTitle>
              <StatusBadge status={execution.status} />
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-slate-400">Original task</div>
                <div>{execution.task?.prompt}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-slate-400">Model</div>
                <div>
                  {execution.modelProvider} / {execution.modelName}
                  {execution.modelProvider === "simulated" ? " (simulated demo LLM)" : ""}
                </div>
              </div>
              <div>Duration: {formatDuration(execution.durationMs)}</div>
              <div>
                Tokens: {execution.promptTokens ?? 0} prompt / {execution.completionTokens ?? 0}{" "}
                completion
                {execution.estimatedCostUsd != null
                  ? ` · est. $${execution.estimatedCostUsd.toFixed(5)}`
                  : ""}
              </div>
              {execution.errorMessage ? (
                <div className="md:col-span-2 text-red-600">Error: {execution.errorMessage}</div>
              ) : null}
              <div className="md:col-span-2">
                <div className="text-xs uppercase text-slate-400">Output summary</div>
                <div>{execution.outputSummary || "—"}</div>
              </div>
            </CardContent>
          </Card>

          {execution.approvals.length > 0 ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Approval requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {execution.approvals.map((a, i) => (
                  <div key={i} className="rounded border border-slate-100 p-3">
                    <div className="font-medium">{a.proposedAction}</div>
                    <div className="text-slate-500">{a.reason}</div>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {execution.steps.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      #{s.stepIndex} {s.title}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  {s.detail ? <p className="mt-1 text-sm text-slate-500">{s.detail}</p> : null}
                  {s.toolInputJson ? (
                    <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-[11px]">
                      {s.toolInputJson}
                    </pre>
                  ) : null}
                  {s.toolResultJson ? (
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[11px]">
                      {s.toolResultJson}
                    </pre>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
