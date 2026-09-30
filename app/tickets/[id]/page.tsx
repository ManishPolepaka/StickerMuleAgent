"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Ticket = {
  id: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  order: {
    orderNumber: string;
    customer: { name: string; email: string };
  } | null;
  customer: { id: string; name: string; email: string; externalId: string } | null;
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/tickets/${params.id}`);
    const data = await res.json();
    if (res.ok) setTicket(data.ticket);
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function setStatus(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setTicket(data.ticket);
      toast.success(`Marked ${status.replaceAll("_", " ")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title={ticket ? `Ticket · ${ticket.category.replaceAll("_", " ")}` : "Ticket"}
      description="Internal support ticket detail"
      actions={
        <Link href="/tickets" className="text-sm text-blue-700 hover:underline">
          Back to queue
        </Link>
      }
    >
      {!ticket ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="grid max-w-3xl gap-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base capitalize">
                {ticket.category.replaceAll("_", " ")}
              </CardTitle>
              <StatusBadge status={ticket.status} />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase text-slate-600">
                  {ticket.priority}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {ticket.createdBy === "order_operations_agent" ? "AI agent" : ticket.createdBy}
                </span>
              </div>
              <p className="leading-relaxed text-slate-800">{ticket.description}</p>
              <div>
                Order:{" "}
                {ticket.order ? (
                  <Link
                    href={`/orders/${ticket.order.orderNumber}`}
                    className="text-blue-700 hover:underline"
                  >
                    {ticket.order.orderNumber}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
              <div>
                Customer:{" "}
                {ticket.customer ? (
                  <Link
                    href={`/customers/${ticket.customer.id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {ticket.customer.name}
                  </Link>
                ) : (
                  "—"
                )}
                {ticket.customer ? (
                  <span className="text-slate-500"> · {ticket.customer.email}</span>
                ) : null}
              </div>
              <div className="text-xs text-slate-400">
                Created {new Date(ticket.createdAt).toLocaleString()} · Updated{" "}
                {new Date(ticket.updatedAt).toLocaleString()}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {ticket.status === "open" ? (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => setStatus("in_progress")}
                  >
                    Mark in progress
                  </Button>
                ) : null}
                {ticket.status === "open" || ticket.status === "in_progress" ? (
                  <Button
                    disabled={busy}
                    className="bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => setStatus("resolved")}
                  >
                    Resolve
                  </Button>
                ) : null}
                {ticket.status === "resolved" ? (
                  <Button disabled={busy} variant="outline" onClick={() => setStatus("closed")}>
                    Close
                  </Button>
                ) : null}
                {ticket.status === "closed" || ticket.status === "resolved" ? (
                  <Button disabled={busy} variant="outline" onClick={() => setStatus("open")}>
                    Reopen
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
