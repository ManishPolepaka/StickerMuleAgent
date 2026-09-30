"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCachedJson } from "@/hooks/use-cached-json";
import { formatDateTime, formatDuration } from "@/lib/utils";

type Execution = {
  id: string;
  agentName: string;
  modelProvider: string;
  modelName: string;
  status: string;
  durationMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  createdAt: string;
  task: { id: string; taskNumber: string; prompt: string };
};

const selectExecutions = (json: unknown) =>
  ((json as { executions?: Execution[] }).executions || []) as Execution[];

export function LogsClient({
  initialExecutions,
}: { initialExecutions?: Execution[] } = {}) {
  const { data: executions = [], loading } = useCachedJson(
    "executions:list",
    "/api/executions",
    selectExecutions,
    initialExecutions,
  );

  return (
    <AppShell
      title="Agent Activity Logs"
      description="Searchable execution history with tool calls, decisions, and outcomes."
    >
      <Card className="border-0">
        <CardContent className="pt-6">
          {loading && executions.length === 0 ? (
            <TableSkeleton rows={8} cols={6} />
          ) : executions.length === 0 ? (
            <p className="text-sm text-slate-500">No executions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Tokens / cost</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/logs/${e.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {e.task.taskNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{e.agentName}</TableCell>
                    <TableCell className="text-xs">
                      {e.modelProvider}/{e.modelName}
                      {e.modelProvider === "simulated" ? (
                        <span className="ml-1 text-amber-700">(demo)</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell>{formatDuration(e.durationMs)}</TableCell>
                    <TableCell className="text-xs">
                      {e.totalTokens ?? "—"}
                      {e.estimatedCostUsd != null
                        ? ` / $${e.estimatedCostUsd.toFixed(5)}`
                        : ""}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDateTime(e.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
