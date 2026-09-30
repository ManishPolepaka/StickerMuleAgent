"use client";

import { AppShell } from "@/components/layout/app-shell";
import { RunInvestigationButton } from "@/components/run-investigation-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Client page so first nav after refresh doesn’t wait on a server round-trip. */
export default function AgentsPage() {
  return (
    <AppShell
      title="AI Agents"
      description="Configured agents for commerce operations. Integrations are demo/simulated."
      actions={<RunInvestigationButton />}
    >
      <Card className="border-0">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Order Operations Agent</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Tool-using agent that investigates delayed orders, sends status emails directly,
              escalates when evidence is insufficient, and requests approval only for restricted
              commercial actions.
            </p>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Active</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Info label="Capabilities" value="10 validated tools · bounded loop · audit log" />
          <Info label="Auto-allowed" value="Reads, status emails, tickets, escalate" />
          <Info label="Requires approval" value="Refunds, credits, cancel, address changes" />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="border-0 opacity-80">
          <CardHeader>
            <CardTitle className="text-base">Returns Agent</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-500">
            Planned for a later release. Not enabled in this demo.
          </CardContent>
        </Card>
        <Card className="border-0 opacity-80">
          <CardHeader>
            <CardTitle className="text-base">Fraud Review Agent</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-500">
            Planned for a later release. Not enabled in this demo.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-800">{value}</div>
    </div>
  );
}
