"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { clientCacheSet } from "@/lib/client/fetch-cache";
import { useClientCacheSnapshot } from "@/hooks/use-cached-json";
import { TableSkeleton } from "@/components/ui/table-skeleton";

type Ticket = {
  id: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  createdBy: string;
  createdAt: string;
  order: { id: string; orderNumber: string } | null;
  customer: { id: string; name: string; email: string; externalId: string } | null;
};

type TicketsPayload = { tickets: Ticket[]; counts: Record<string, number> };

export function TicketsClient({
  initialTickets,
  initialCounts,
}: {
  initialTickets?: Ticket[];
  initialCounts?: Record<string, number>;
} = {}) {
  const cached = useClientCacheSnapshot<TicketsPayload>("tickets:list");
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets ?? []);
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts ?? {});
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [createdBy, setCreatedBy] = useState("all");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialTickets === undefined);

  const viewTickets =
    tickets.length > 0 || initialTickets ? tickets : cached?.tickets ?? tickets;
  const viewCounts =
    Object.keys(counts).length > 0 || initialCounts ? counts : cached?.counts ?? counts;

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (createdBy) params.set("createdBy", createdBy);
    if (q.trim()) params.set("q", q.trim());
    return fetch(`/api/tickets?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const next = { tickets: d.tickets || [], counts: d.counts || {} };
        if (status === "all" && priority === "all" && createdBy === "all" && !q.trim()) {
          clientCacheSet("tickets:list", next);
        }
        setTickets(next.tickets);
        setCounts(next.counts);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, priority, createdBy, q]);

  useEffect(() => {
    if (initialTickets) {
      clientCacheSet("tickets:list", {
        tickets: initialTickets,
        counts: initialCounts || {},
      });
    }
  }, [initialTickets, initialCounts]);

  useEffect(() => {
    if (cached && tickets.length === 0 && !initialTickets) {
      setTickets(cached.tickets);
      setCounts(cached.counts);
      setLoading(false);
    }
  }, [cached, tickets.length, initialTickets]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(id: string, next: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast.success(`Ticket marked ${next.replaceAll("_", " ")}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  const openCount = viewCounts.open || 0;
  const inProgressCount = viewCounts.in_progress || 0;
  const resolvedCount = (viewCounts.resolved || 0) + (viewCounts.closed || 0);

  return (
    <AppShell
      title="Support Tickets"
      description="Internal demo ticket queue. Agents create tickets during investigations; operators triage them here."
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Open" value={openCount} />
        <Stat label="In progress" value={inProgressCount} />
        <Stat label="Resolved / closed" value={resolvedCount} />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Filter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            ["all", "All"],
            ["open", "Open"],
            ["in_progress", "In progress"],
            ["resolved", "Resolved"],
            ["closed", "Closed"],
          ]}
        />
        <Filter
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={[
            ["all", "All"],
            ["urgent", "Urgent"],
            ["high", "High"],
            ["medium", "Medium"],
            ["low", "Low"],
          ]}
        />
        <Filter
          label="Created by"
          value={createdBy}
          onChange={setCreatedBy}
          options={[
            ["all", "All"],
            ["agent", "AI agent"],
            ["human", "Human / seed"],
          ]}
        />
        <div className="min-w-[220px] flex-1 space-y-1">
          <label className="text-xs font-medium text-slate-500">Search</label>
          <Input
            placeholder="Order, customer, description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="pt-6">
          {loading && viewTickets.length === 0 ? (
            <TableSkeleton rows={8} cols={6} />
          ) : viewTickets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No tickets match these filters. Run an investigation that creates a support ticket,
              or clear filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewTickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="capitalize">{t.priority}</TableCell>
                    <TableCell className="capitalize">
                      {t.category.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell>
                      {t.order ? (
                        <Link
                          href={`/orders/${t.order.orderNumber}`}
                          className="text-blue-700 hover:underline"
                        >
                          {t.order.orderNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {t.customer ? (
                        <div>
                          <div>{t.customer.name}</div>
                          <div className="text-xs text-slate-400">{t.customer.email}</div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="line-clamp-2 text-slate-700 hover:text-blue-700"
                      >
                        {t.description}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.createdBy === "order_operations_agent" ? (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                          AI agent
                        </span>
                      ) : (
                        t.createdBy
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDateTime(t.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {t.status === "open" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busyId === t.id}
                            onClick={() => updateStatus(t.id, "in_progress")}
                          >
                            Start
                          </Button>
                        ) : null}
                        {t.status === "open" || t.status === "in_progress" ? (
                          <Button
                            size="xs"
                            className="bg-blue-600 text-white hover:bg-blue-700"
                            disabled={busyId === t.id}
                            onClick={() => updateStatus(t.id, "resolved")}
                          >
                            Resolve
                          </Button>
                        ) : null}
                        {t.status === "resolved" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busyId === t.id}
                            onClick={() => updateStatus(t.id, "closed")}
                          >
                            Close
                          </Button>
                        ) : null}
                      </div>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="pt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      </CardContent>
    </Card>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <select
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
