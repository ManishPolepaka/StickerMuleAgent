"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEventSource } from "@/hooks/use-event-source";
import { clientCacheSet } from "@/lib/client/fetch-cache";
import { useClientCacheSnapshot } from "@/hooks/use-cached-json";
import { formatDateTime } from "@/lib/utils";
import { TableSkeleton } from "@/components/ui/table-skeleton";

type TriggerRow = {
  id: string;
  type: string;
  source: string;
  status: string;
  routerDecision: string | null;
  taskId: string | null;
  createdAt: string;
  task: { taskNumber: string } | null;
};

type MessageRow = {
  id: string;
  channel: string;
  fromEmail: string;
  subject: string;
  body: string;
  orderNumber: string | null;
  status: string;
  classification: string | null;
  taskId: string | null;
  createdAt: string;
};

type TriggersPayload = { triggers: TriggerRow[]; messages: MessageRow[] };

export function TriggersClient({
  initialTriggers,
  initialMessages,
}: {
  initialTriggers?: TriggerRow[];
  initialMessages?: MessageRow[];
} = {}) {
  const cached = useClientCacheSnapshot<TriggersPayload>("triggers:list");
  const [triggers, setTriggers] = useState<TriggerRow[]>(initialTriggers ?? []);
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState("Connecting…");
  const [loading, setLoading] = useState(
    initialTriggers === undefined && initialMessages === undefined,
  );

  const viewTriggers =
    triggers.length > 0 || initialTriggers ? triggers : cached?.triggers ?? triggers;
  const viewMessages =
    messages.length > 0 || initialMessages ? messages : cached?.messages ?? messages;

  const [fromEmail, setFromEmail] = useState("customer@example.com");
  const [subject, setSubject] = useState("Where is my order ORD-1000?");
  const [body, setBody] = useState(
    "Hi, my order ORD-1000 was supposed to arrive already. Can you check the status?",
  );
  const [shipOrder, setShipOrder] = useState("ORD-1001");
  const [prodOrder, setProdOrder] = useState("ORD-1008");

  async function load() {
    const res = await fetch("/api/triggers");
    const data = await res.json();
    if (res.ok) {
      const next = {
        triggers: (data.triggers || []) as TriggerRow[],
        messages: (data.messages || []) as MessageRow[],
      };
      clientCacheSet("triggers:list", next);
      setTriggers(next.triggers);
      setMessages(next.messages);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (initialTriggers || initialMessages) {
      clientCacheSet("triggers:list", {
        triggers: initialTriggers || [],
        messages: initialMessages || [],
      });
    }
  }, [initialTriggers, initialMessages]);

  useEffect(() => {
    if (cached && triggers.length === 0 && !initialTriggers) {
      setTriggers(cached.triggers);
      setMessages(cached.messages);
      setLoading(false);
    }
  }, [cached, triggers.length, initialTriggers]);

  useEffect(() => {
    void load();
  }, []);

  useEventSource("/api/realtime/stream", (event) => {
    if (event.type === "connected") {
      setLiveNote("Live");
      return;
    }
    if (
      event.type === "trigger_processed" ||
      event.type === "task_updated" ||
      event.type === "dashboard_changed"
    ) {
      setLiveNote(`Live · updated ${new Date().toLocaleTimeString()}`);
      // Router finished — don't leave the button stuck on "Routing…" while the
      // HTTP response is still waiting on slow DB round-trips.
      if (event.type === "trigger_processed") {
        setBusy(null);
      }
      void load();
    }
  });

  async function run(action: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const res = await fetch("/api/triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (data.skippedExisting && data.task) {
        toast.message(
          `Already investigating ${data.task.taskNumber} — open that task instead of starting another.`,
        );
      } else if (data.task || data.results?.some((r: { task?: unknown }) => r.task)) {
        toast.success(`${label} completed — agent started`);
      } else {
        toast.success(
          data.decision?.reason
            ? `${label}: ${data.decision.reason}`
            : `${label} completed (no agent needed)`,
        );
      }
      void load();
    } catch (err) {
      void load();
      if (
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
        toast.message("Still working — check Inbox / Tasks; the agent may already be running.");
      } else {
        toast.error(err instanceof Error ? err.message : "Trigger failed");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      title="Triggers & Inbox"
      description="Automatic starters for the Order Operations Agent. Router decides whether to start; the AI decides how to investigate."
      actions={
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          {liveNote}
        </div>
      }
    >
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>How it works:</strong> an event arrives → rule router classifies it → if it is an
        ops issue, an investigation starts automatically → agent uses tools in real time.
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-blue-600" />
              Simulate customer message
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>From</Label>
              <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Body</Label>
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <Button
              disabled={Boolean(busy)}
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => {
                const match = `${subject} ${body}`.match(/\bORD-\d+\b/i);
                run(
                  {
                    action: "customer_message",
                    channel: "email",
                    fromEmail,
                    subject,
                    body,
                    orderNumber: match?.[0]?.toUpperCase() ?? null,
                  },
                  "Customer message",
                );
              }}
            >
              {busy === "Customer message" ? "Routing…" : "Send to inbox → route → agent"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">System & operator triggers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              className="w-full justify-start"
              onClick={() => run({ action: "late_order_scan", limit: 3 }, "Late order scan")}
            >
              Scan late orders (expected delivery passed)
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              className="w-full justify-start"
              onClick={() => run({ action: "sla_scan", hours: 4 }, "SLA scan")}
            >
              Scan SLA breaches (open tickets &gt; 4h)
            </Button>
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              className="w-full justify-start"
              onClick={() => run({ action: "bulk_scan", limit: 5 }, "Bulk scan")}
            >
              Bulk investigate delayed / problem orders
            </Button>

            <div className="grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-[1fr_auto]">
              <Input value={shipOrder} onChange={(e) => setShipOrder(e.target.value)} />
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() =>
                  run(
                    {
                      action: "shipping_webhook",
                      orderNumber: shipOrder,
                      status: "address_issue",
                      eventLabel: "Undeliverable as addressed",
                      location: "Regional hub",
                    },
                    "Shipping webhook",
                  )
                }
              >
                Shipping exception webhook
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input value={prodOrder} onChange={(e) => setProdOrder(e.target.value)} />
              <Button
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() =>
                  run(
                    {
                      action: "production_delay",
                      orderNumber: prodOrder,
                      delayReason: "Machine downtime on press line 2",
                    },
                    "Production delay",
                  )
                }
              >
                Production delay signal
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Inbox messages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {viewMessages.length === 0 ? (
              <p className="text-sm text-slate-500">No messages yet. Simulate one above.</p>
            ) : (
              viewMessages.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{m.subject}</div>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="text-xs text-slate-500">
                    {m.channel} · {m.fromEmail} · {m.classification || "—"}
                  </div>
                  {m.taskId ? (
                    <Link href={`/tasks/${m.taskId}`} className="text-xs text-blue-700 hover:underline">
                      Open investigation
                    </Link>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Trigger event log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {viewTriggers.length === 0 ? (
              <p className="text-sm text-slate-500">No triggers yet.</p>
            ) : (
              viewTriggers.map((t) => {
                let reason = "";
                try {
                  reason = t.routerDecision
                    ? (JSON.parse(t.routerDecision) as { reason?: string }).reason || ""
                    : "";
                } catch {
                  reason = "";
                }
                return (
                  <div key={t.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium capitalize">{t.type.replaceAll("_", " ")}</div>
                      <StatusBadge status={t.status} />
                    </div>
                    <div className="text-xs text-slate-500">
                      {t.source} · {formatDateTime(t.createdAt)}
                    </div>
                    {reason ? <div className="mt-1 text-xs text-slate-600">{reason}</div> : null}
                    {t.taskId ? (
                      <Link
                        href={`/tasks/${t.taskId}`}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        {t.task?.taskNumber || "Open task"}
                      </Link>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
